/**
 * MonsoonTracker — Monsoon Onset and Progression Tracker.
 *
 * Exports pure functions for monsoon computations (testable), plus a React
 * component rendering:
 *  1. Animated isochrone map showing predicted monsoon onset dates as colour bands
 *  2. IMD-declared advance/retreat reference lines overlay
 *  3. "Days Ahead/Behind Normal" indicator per isochrone band
 *  4. ISMR-type monsoon index gauge in the analytics panel
 *
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** An isochrone band showing the predicted monsoon onset date for a latitude zone */
export interface IsochroneBand {
  /** Latitude of the isochrone centre (°N) */
  lat: number;
  /** ISO date string of predicted monsoon onset (YYYY-MM-DD) */
  predictedOnsetDate: string;
  /** ISO date string of IMD-declared normal onset (YYYY-MM-DD) */
  normalOnsetDate: string;
  /** Positive = ahead of normal, negative = behind normal (days) */
  daysAheadOfNormal: number;
  /** CSS colour for this isochrone band */
  color: string;
}

/** IMD reference line for a specific date of historical monsoon advance/retreat */
export interface IMDReferenceLine {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Latitude the monsoon front reached on this date (°N) */
  lat: number;
  /** 'advance' = SW monsoon onset, 'retreat' = NE monsoon retreat */
  type: 'advance' | 'retreat';
  /** Human-readable label, e.g. "Normal Onset – Kerala (Jun 1)" */
  label: string;
}

/** ISMR-type monsoon index result */
export interface MonsoonIndex {
  /** Normalised index value in [0, 1] — 1 = climatological normal */
  value: number;
  /** Raw average rainfall (mm/day) over the monsoon core zone */
  rainfallMmPerDay: number;
  /** Climatological normal for the period (mm/day) */
  normalMmPerDay: number;
  /** Classification of current monsoon activity */
  category: MonsoonCategory;
}

export type MonsoonCategory = 'deficient' | 'below_normal' | 'normal' | 'above_normal' | 'excess';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * IMD normal monsoon onset dates by latitude zone (SW Monsoon).
 * Source: IMD Long Range Forecast climatological normals.
 * Maps approx latitude (°N) → ISO date string (YYYY-MM-DD, fixed year 2000 as anchor).
 */
export const IMD_NORMAL_ONSET_BY_LAT: Array<{ lat: number; date: string; label: string }> = [
  { lat: 8.5,  date: '2000-06-01', label: 'Kerala (Jun 1)' },
  { lat: 10.0, date: '2000-06-05', label: 'S. Karnataka (Jun 5)' },
  { lat: 12.0, date: '2000-06-10', label: 'Karnataka Coast (Jun 10)' },
  { lat: 14.0, date: '2000-06-12', label: 'Goa (Jun 12)' },
  { lat: 16.0, date: '2000-06-15', label: 'Telangana (Jun 15)' },
  { lat: 18.0, date: '2000-06-20', label: 'Vidarbha (Jun 20)' },
  { lat: 20.0, date: '2000-06-25', label: 'Odisha/MP (Jun 25)' },
  { lat: 22.0, date: '2000-07-01', label: 'W. Bengal/Gujarat (Jul 1)' },
  { lat: 24.0, date: '2000-07-05', label: 'Rajasthan/UP (Jul 5)' },
  { lat: 26.0, date: '2000-07-10', label: 'IGP Central (Jul 10)' },
  { lat: 28.0, date: '2000-07-15', label: 'Delhi/Punjab (Jul 15)' },
  { lat: 30.0, date: '2000-07-20', label: 'Himachal (Jul 20)' },
  { lat: 32.0, date: '2000-07-25', label: 'J&K (Jul 25)' },
];

/** ISMR (Indian Summer Monsoon Rainfall) core zone bounding box (approx) */
export const ISMR_CORE_ZONE = { latMin: 8, latMax: 28, lonMin: 68, lonMax: 97 };

/** Climatological ISMR average rainfall (mm/day) over the Jun–Sep season */
export const ISMR_NORMAL_MM_PER_DAY = 6.5;

/** Isochrone colour palette (cool blues → warm oranges for early → late onset) */
export const ISOCHRONE_COLORS = [
  '#22d3ee', // cyan-400  — Jun 1 (earliest)
  '#34d399', // emerald-400
  '#a3e635', // lime-400
  '#facc15', // yellow-400
  '#fb923c', // orange-400
  '#f87171', // red-400
  '#c084fc', // purple-400 — late Jul (latest)
];

/** Category colour map for the monsoon index gauge */
export const MONSOON_CATEGORY_COLOR: Record<MonsoonCategory, string> = {
  deficient:    '#ef4444',  // red
  below_normal: '#f97316',  // orange
  normal:       '#22c55e',  // green
  above_normal: '#38bdf8',  // sky blue
  excess:       '#818cf8',  // indigo
};

/** IMD reference lines — representative SW monsoon advance dates */
export const IMD_REFERENCE_LINES: IMDReferenceLine[] = [
  { date: '2000-06-01', lat: 8.5,  type: 'advance', label: 'Normal Onset – Kerala (Jun 1)' },
  { date: '2000-07-01', lat: 22.0, type: 'advance', label: 'Normal Onset – Central India (Jul 1)' },
  { date: '2000-07-15', lat: 28.0, type: 'advance', label: 'Normal Onset – Delhi (Jul 15)' },
  { date: '2000-09-01', lat: 30.0, type: 'retreat', label: 'Normal Retreat – NW India (Sep 1)' },
  { date: '2000-10-15', lat: 12.0, type: 'retreat', label: 'Normal Retreat – S. India (Oct 15)' },
];

// ── Pure Functions (exported for testing) ─────────────────────────────────────

/**
 * Parse an ISO date string (YYYY-MM-DD) and return a Date object with year
 * normalised to the given year for cross-year day comparisons.
 */
export function toNormalizedDate(isoDate: string, year: number = 2000): Date {
  const [, mm, dd] = isoDate.split('-');
  return new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
}

/**
 * Compute the number of days between two ISO date strings (a − b).
 * Positive = a is later than b; negative = a is earlier than b.
 */
export function daysDifference(isoA: string, isoB: string): number {
  const a = toNormalizedDate(isoA);
  const b = toNormalizedDate(isoB);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((a.getTime() - b.getTime()) / msPerDay);
}

/**
 * Classify a monsoon index value into a MonsoonCategory.
 *
 * IMD ISMR departure thresholds (% of normal):
 *  Excess       > +20%
 *  Above normal +10% to +20%
 *  Normal       −10% to +10%
 *  Below normal −10% to −20%
 *  Deficient    < −20%
 */
export function classifyMonsoonIndex(value: number): MonsoonCategory {
  if (value > 1.20) return 'excess';
  if (value > 1.10) return 'above_normal';
  if (value >= 0.90) return 'normal';
  if (value >= 0.80) return 'below_normal';
  return 'deficient';
}

/**
 * Compute the ISMR-type monsoon index from the current grid cells.
 *
 * The index = mean(rainfall in core zone) / ISMR_NORMAL_MM_PER_DAY.
 * Returns null when no cells fall in the core zone.
 *
 * Requirement 18.4
 */
export function computeMonsoonIndex(
  gridCells: GridCell[],
  normalMmPerDay: number = ISMR_NORMAL_MM_PER_DAY,
): MonsoonIndex | null {
  const coreZoneCells = gridCells.filter(
    (c) =>
      c.lat >= ISMR_CORE_ZONE.latMin &&
      c.lat <= ISMR_CORE_ZONE.latMax &&
      c.lon >= ISMR_CORE_ZONE.lonMin &&
      c.lon <= ISMR_CORE_ZONE.lonMax,
  );

  if (coreZoneCells.length === 0) return null;

  const rainfallMmPerDay =
    coreZoneCells.reduce((sum, c) => sum + c.rainfall, 0) / coreZoneCells.length;

  const value = normalMmPerDay > 0 ? rainfallMmPerDay / normalMmPerDay : 0;

  return {
    value,
    rainfallMmPerDay,
    normalMmPerDay,
    category: classifyMonsoonIndex(value),
  };
}

/**
 * Assign an isochrone colour for a latitude band based on its index in the
 * ordered lat zones (0 = southernmost = earliest onset).
 */
export function isochroneColor(bandIndex: number): string {
  return ISOCHRONE_COLORS[Math.min(bandIndex, ISOCHRONE_COLORS.length - 1)];
}

/**
 * Build isochrone bands from a grid.
 *
 * For each latitude zone defined in IMD_NORMAL_ONSET_BY_LAT, the predicted
 * onset date is estimated from mean rainfall in that zone: high rainfall
 * (above ISMR normal) → onset brought forward; low rainfall → onset delayed.
 *
 * The heuristic maps the rainfall anomaly ratio to a ±30-day shift.
 *
 * Requirement 18.1, 18.3
 */
export function buildIsochroneBands(
  gridCells: GridCell[],
  baseYear: number = new Date().getFullYear(),
): IsochroneBand[] {
  const bands: IsochroneBand[] = [];

  IMD_NORMAL_ONSET_BY_LAT.forEach((zone, idx) => {
    const tol = 1.25; // degrees — collect cells within ±1.25° of the zone lat
    const zoneCells = gridCells.filter(
      (c) => Math.abs(c.lat - zone.lat) <= tol,
    );

    // If no cells in zone, use normal date with 0 offset
    const meanRainfall =
      zoneCells.length > 0
        ? zoneCells.reduce((s, c) => s + c.rainfall, 0) / zoneCells.length
        : ISMR_NORMAL_MM_PER_DAY;

    // Anomaly ratio: >1 = wetter than normal → earlier onset
    const anomalyRatio = ISMR_NORMAL_MM_PER_DAY > 0
      ? meanRainfall / ISMR_NORMAL_MM_PER_DAY
      : 1;

    // Shift in days: wetter = earlier (negative), drier = later (positive)
    const shiftDays = Math.round((1 - anomalyRatio) * 15);  // ±15 day max

    const normalDate = toNormalizedDate(zone.date, baseYear);
    const predictedDate = new Date(normalDate.getTime() + shiftDays * 24 * 60 * 60 * 1000);

    const pad = (n: number) => String(n).padStart(2, '0');
    const toISO = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    bands.push({
      lat: zone.lat,
      predictedOnsetDate: toISO(predictedDate),
      normalOnsetDate: zone.date.replace('2000', String(baseYear)),
      daysAheadOfNormal: -shiftDays,   // negative shiftDays = ahead of normal
      color: isochroneColor(idx),
    });
  });

  return bands;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

/** Mock isochrone bands used when no grid data is available */
export const MOCK_ISOCHRONE_BANDS: IsochroneBand[] = IMD_NORMAL_ONSET_BY_LAT.map(
  (zone, idx) => ({
    lat: zone.lat,
    predictedOnsetDate: zone.date.replace('2000', String(new Date().getFullYear())),
    normalOnsetDate: zone.date.replace('2000', String(new Date().getFullYear())),
    daysAheadOfNormal: idx % 3 === 0 ? 3 : idx % 3 === 1 ? -2 : 0,
    color: isochroneColor(idx),
  }),
);

/** Mock monsoon index for demo */
export const MOCK_MONSOON_INDEX: MonsoonIndex = {
  value: 1.08,
  rainfallMmPerDay: 7.02,
  normalMmPerDay: ISMR_NORMAL_MM_PER_DAY,
  category: 'above_normal',
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Horizontal gauge bar for the monsoon index */
const MonsoonGauge: React.FC<{ index: MonsoonIndex }> = ({ index }) => {
  const pct = Math.min(100, Math.max(0, (index.value / 1.5) * 100));
  const normalPct = (1.0 / 1.5) * 100;
  const color = MONSOON_CATEGORY_COLOR[index.category];

  const categoryLabel: Record<MonsoonCategory, string> = {
    deficient:    'Deficient',
    below_normal: 'Below Normal',
    normal:       'Normal',
    above_normal: 'Above Normal',
    excess:       'Excess',
  };

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
          ISMR Index
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color }}>
          {categoryLabel[index.category]} ({(index.value * 100).toFixed(0)}% of normal)
        </span>
      </div>

      {/* Track */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(index.value * 100)}
        aria-valuemin={0}
        aria-valuemax={150}
        aria-label={`Monsoon index: ${categoryLabel[index.category]}`}
        style={{
          position: 'relative',
          height: '12px',
          borderRadius: '6px',
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
      >
        {/* Filled bar */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}99, ${color})`,
            borderRadius: '6px',
            transition: 'width 0.6s ease',
          }}
        />
        {/* Normal marker */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${normalPct}%`,
            top: 0,
            height: '100%',
            width: '2px',
            background: 'rgba(255,255,255,0.7)',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
        <span>0%</span>
        <span style={{ color: 'rgba(255,255,255,0.55)' }}>Normal ({ISMR_NORMAL_MM_PER_DAY} mm/day)</span>
        <span>150%</span>
      </div>

      <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '12px' }}>
        {[
          { label: 'Current avg', value: `${index.rainfallMmPerDay.toFixed(1)} mm/day` },
          { label: 'Climatological normal', value: `${index.normalMmPerDay.toFixed(1)} mm/day` },
        ].map(({ label, value }) => (
          <div key={label}>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>{label}: </span>
            <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** A single isochrone row showing lat band, predicted date, and days ahead/behind */
const IsochroneRow: React.FC<{
  band: IsochroneBand;
  showIMD: boolean;
  isHighlighted: boolean;
  onHover: (lat: number | null) => void;
}> = ({ band, showIMD, isHighlighted, onHover }) => {
  const ahead = band.daysAheadOfNormal;
  const aheadLabel =
    ahead === 0 ? 'On time' : ahead > 0 ? `${ahead}d ahead` : `${Math.abs(ahead)}d behind`;
  const aheadColor = ahead > 0 ? '#22c55e' : ahead < 0 ? '#f87171' : 'rgba(255,255,255,0.55)';

  return (
    <tr
      onMouseEnter={() => onHover(band.lat)}
      onMouseLeave={() => onHover(null)}
      style={{
        background: isHighlighted ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'background 120ms ease',
        cursor: 'default',
      }}
    >
      {/* Colour swatch + lat */}
      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            aria-hidden="true"
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: band.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}>
            {band.lat.toFixed(1)}°N
          </span>
        </div>
      </td>

      {/* Predicted onset */}
      <td style={{ padding: '5px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.85)', fontFamily: 'monospace' }}>
        {band.predictedOnsetDate.slice(5)}  {/* MM-DD */}
      </td>

      {/* IMD normal (conditionally shown) */}
      {showIMD && (
        <td style={{ padding: '5px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
          {band.normalOnsetDate.slice(5)}
        </td>
      )}

      {/* Days ahead/behind */}
      <td style={{ padding: '5px 8px', textAlign: 'right' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: aheadColor,
            background: `${aheadColor}18`,
            border: `1px solid ${aheadColor}44`,
            borderRadius: '4px',
            padding: '1px 5px',
            whiteSpace: 'nowrap',
          }}
        >
          {aheadLabel}
        </span>
      </td>
    </tr>
  );
};

/** Animated isochrone map rendered as an SVG schematic of India's lat bands */
const IsochroneMap: React.FC<{
  bands: IsochroneBand[];
  showIMD: boolean;
  animating: boolean;
  highlightedLat: number | null;
}> = ({ bands, showIMD, animating, highlightedLat }) => {
  // Map lat [8, 33] → y position in SVG [10, 190] (top = northernmost)
  const latToY = (lat: number) => 10 + ((33 - lat) / 25) * 180;

  return (
    <div
      role="img"
      aria-label="Monsoon isochrone map showing predicted onset latitudes"
      style={{
        position: 'relative',
        width: '100%',
        background: 'rgba(0,0,0,0.25)',
        borderRadius: '8px',
        overflow: 'hidden',
        marginBottom: '16px',
      }}
    >
      <svg viewBox="0 0 300 200" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg">
        {/* Background gradient for ocean/land hint */}
        <defs>
          <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#0a1628" stopOpacity="0.8" />
          </linearGradient>
          <clipPath id="indiaClip">
            <rect x="20" y="5" width="260" height="190" />
          </clipPath>
        </defs>
        <rect width="300" height="200" fill="url(#bgGrad)" />

        {/* Latitude grid lines */}
        {[10, 15, 20, 25, 30].map((lat) => (
          <g key={lat}>
            <line
              x1="20" y1={latToY(lat)} x2="280" y2={latToY(lat)}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"
            />
            <text x="14" y={latToY(lat) + 3} fontSize="6" fill="rgba(255,255,255,0.25)" textAnchor="end">
              {lat}°
            </text>
          </g>
        ))}

        {/* IMD reference lines */}
        {showIMD && IMD_REFERENCE_LINES.filter(l => l.type === 'advance').map((ref) => (
          <line
            key={ref.date}
            x1="20" y1={latToY(ref.lat)} x2="280" y2={latToY(ref.lat)}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1"
            strokeDasharray="4 3"
          >
            <title>{ref.label}</title>
          </line>
        ))}

        {/* Isochrone bands — animated horizontal filled bars */}
        {bands.map((band, idx) => {
          const y = latToY(band.lat);
          const nextBand = bands[idx + 1];
          const yNext = nextBand ? latToY(nextBand.lat) : y - 14;
          const bandHeight = Math.abs(y - yNext);
          const isHighlighted = highlightedLat === band.lat;

          return (
            <rect
              key={band.lat}
              x="20"
              y={yNext}
              width="260"
              height={bandHeight}
              fill={band.color}
              opacity={isHighlighted ? 0.55 : 0.28}
              style={{
                transition: 'opacity 200ms ease',
                animation: animating ? `monsoon-sweep 1.2s ease-in-out ${idx * 0.08}s infinite alternate` : 'none',
              }}
            />
          );
        })}

        {/* Predicted onset date labels on the map */}
        {bands.map((band) => (
          <text
            key={`label-${band.lat}`}
            x="285"
            y={latToY(band.lat) + 3}
            fontSize="5"
            fill={band.color}
            textAnchor="start"
          >
            {band.predictedOnsetDate.slice(5)}
          </text>
        ))}

        {/* "Arrow" indicating monsoon advance direction */}
        <text x="148" y="195" fontSize="8" fill="rgba(255,255,255,0.3)" textAnchor="middle">
          ↑ SW Monsoon Advance →
        </text>
      </svg>
    </div>
  );
};

/** Legend bar for isochrone colours */
const IsochroneLegend: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
    {ISOCHRONE_COLORS.map((color, i) => (
      <div key={color} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} aria-hidden="true" />
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)' }}>
          {['Jun 1', 'Jun 10', 'Jun 20', 'Jul 1', 'Jul 10', 'Jul 20', 'Jul 25'][i]}
        </span>
      </div>
    ))}
  </div>
);

/** IMD reference line legend */
const IMDLegend: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <svg width="20" height="4">
        <line x1="0" y1="2" x2="20" y2="2" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
      <span>IMD Normal Advance</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ width: '14px', height: '6px', borderRadius: '2px', background: 'rgba(99,179,237,0.4)' }} />
      <span>Predicted isochrone band</span>
    </div>
  </div>
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MonsoonTrackerProps {
  /** Grid cells from the active prediction; when absent, mock data is used */
  gridCells?: GridCell[];
  /** Whether the monsoon tracker panel is enabled */
  enabled?: boolean;
  /** Whether to overlay IMD reference advance/retreat dates (Req 18.2) */
  showIMDReference?: boolean;
  /** Callback for external components (e.g. CesiumGlobe) to receive band data */
  onBandsUpdate?: (bands: IsochroneBand[]) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * MonsoonTracker — Monsoon Onset and Progression Tracker.
 *
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4
 */
export const MonsoonTracker: React.FC<MonsoonTrackerProps> = ({
  gridCells,
  enabled = true,
  showIMDReference = true,
  onBandsUpdate,
}) => {
  const [animating, setAnimating] = useState(false);
  const [highlightedLat, setHighlightedLat] = useState<number | null>(null);
  const onBandsUpdateRef = useRef(onBandsUpdate);
  onBandsUpdateRef.current = onBandsUpdate;

  const bands = useMemo<IsochroneBand[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return MOCK_ISOCHRONE_BANDS;
    return buildIsochroneBands(gridCells);
  }, [gridCells, enabled]);

  const monsoonIndex = useMemo<MonsoonIndex | null>(() => {
    if (!enabled) return null;
    if (!gridCells || gridCells.length === 0) return MOCK_MONSOON_INDEX;
    return computeMonsoonIndex(gridCells) ?? MOCK_MONSOON_INDEX;
  }, [gridCells, enabled]);

  // Notify parent on band update
  useEffect(() => {
    if (bands.length > 0) {
      onBandsUpdateRef.current?.(bands);
    }
  }, [bands]);

  // Summary stats for header banner
  const aheadCount  = bands.filter((b) => b.daysAheadOfNormal > 0).length;
  const behindCount = bands.filter((b) => b.daysAheadOfNormal < 0).length;
  const meanOffset  = bands.length > 0
    ? bands.reduce((s, b) => s + b.daysAheadOfNormal, 0) / bands.length
    : 0;
  const isMonsoonActive = monsoonIndex ? monsoonIndex.value >= 0.8 : false;

  if (!enabled) return null;

  return (
    <div
      className="monsoon-tracker"
      data-testid="monsoon-tracker"
      role="region"
      aria-label="Monsoon Onset and Progression Tracker"
    >
      {/* ── Activity banner ── */}
      {isMonsoonActive && monsoonIndex && (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: `${MONSOON_CATEGORY_COLOR[monsoonIndex.category]}18`,
            border: `1px solid ${MONSOON_CATEGORY_COLOR[monsoonIndex.category]}`,
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'monsoon-banner-pulse 3s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: '18px' }} aria-hidden="true">🌧️</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: MONSOON_CATEGORY_COLOR[monsoonIndex.category] }}>
            Monsoon Active
          </span>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginLeft: '4px' }}>
            {meanOffset >= 0 ? '+' : ''}{meanOffset.toFixed(0)} days avg vs normal ·{' '}
            {aheadCount} zones ahead · {behindCount} zones behind
          </span>
          <button
            onClick={() => setAnimating((v) => !v)}
            aria-pressed={animating}
            aria-label={animating ? 'Pause isochrone animation' : 'Play isochrone animation'}
            style={{
              marginLeft: 'auto',
              background: animating ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '6px',
              color: 'rgba(255,255,255,0.8)',
              fontSize: '12px',
              padding: '3px 10px',
              cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
          >
            {animating ? '⏸ Pause' : '▶ Animate'}
          </button>
        </div>
      )}

      <GlassPanel padding="md" className="monsoon-panel">
        <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(255,255,255,0.95)', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🌦 Monsoon Onset Tracker
          <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>
            {bands.length} zones
          </span>
        </h3>

        {/* Monsoon index gauge (Req 18.4) */}
        {monsoonIndex && <MonsoonGauge index={monsoonIndex} />}

        {/* Colour legend */}
        <IsochroneLegend />
        {showIMDReference && <IMDLegend />}

        {/* Animated SVG isochrone map (Req 18.1) */}
        <IsochroneMap
          bands={bands}
          showIMD={showIMDReference}
          animating={animating}
          highlightedLat={highlightedLat}
        />

        {/* Isochrone band table with Days Ahead/Behind Normal (Req 18.3) */}
        <div style={{ overflowY: 'auto', maxHeight: '280px' }}>
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
            aria-label="Monsoon onset dates by latitude zone"
          >
            <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
              <tr>
                {(['Zone', 'Predicted', ...(showIMDReference ? ['Normal'] : []), 'Status'] as string[]).map((col) => (
                  <th
                    key={col}
                    scope="col"
                    style={{
                      padding: '5px 8px',
                      textAlign: col === 'Status' ? 'right' : 'left',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.45)',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bands.map((band) => (
                <IsochroneRow
                  key={band.lat}
                  band={band}
                  showIMD={showIMDReference}
                  isHighlighted={highlightedLat === band.lat}
                  onHover={setHighlightedLat}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* IMD reference lines list (Req 18.2) */}
        {showIMDReference && (
          <div style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              IMD Reference Lines
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {IMD_REFERENCE_LINES.map((ref) => (
                <div key={ref.date} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                  <span style={{ color: ref.type === 'advance' ? '#22d3ee' : '#f97316', fontFamily: 'monospace', minWidth: '32px' }}>
                    {ref.type === 'advance' ? '↑' : '↓'} {ref.lat}°N
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.7)', flex: 1 }}>{ref.label}</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                    {ref.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes monsoon-banner-pulse {
          0%, 100% { box-shadow: 0 0 6px rgba(34,211,238,0.2); }
          50%       { box-shadow: 0 0 18px rgba(34,211,238,0.5); }
        }
        @keyframes monsoon-sweep {
          from { opacity: 0.22; }
          to   { opacity: 0.48; }
        }
      `}</style>
    </div>
  );
};

export default MonsoonTracker;
