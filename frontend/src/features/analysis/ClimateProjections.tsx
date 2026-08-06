/**
 * ClimateProjections — Climate Risk Score Dashboard + Climate Teleconnection Visualization.
 *
 * Exports pure functions for computing composite Climate Risk Scores
 * (testable), plus a React component rendering:
 *  1. District-level choropleth (green → red gradient)
 *  2. Ranked district table with hazard component breakdowns
 *  3. Warning icons for districts with score > 75
 *
 * Also exports the TeleconnectionPanel (task 15.2) rendering:
 *  1. ENSO, IOD, MJO index values (Req 35.1)
 *  2. SST anomaly patterns in Pacific/Indian Ocean (Req 35.2)
 *  3. Correlated Indian grid cells for selected driver (Req 35.3)
 *  4. Historical correlation charts for ENSO/IOD impacts (Req 35.4)
 *
 * Validates: Requirements 26.1, 26.2, 26.3, 26.4, 35.1, 35.2, 35.3, 35.4
 */

import React, { useMemo, useState, useCallback } from 'react';
import { GlassPanel } from '../../design-system';

// ════════════════════════════════════════════════════════════════════════════
// SHARED TYPES
// ════════════════════════════════════════════════════════════════════════════

/** Hazard component scores, each in [0, 100] */
export interface HazardScores {
  flood: number;
  drought: number;
  heatwave: number;
  cyclone: number;
}

/** Full Climate Risk Score for a district */
export interface ClimateRiskScore {
  district: string;
  state: string;
  overall: number; // 0-100
  components: HazardScores;
}

/** Sort direction for the ranked table */
export type SortDirection = 'desc' | 'asc';

/** Which column to sort by */
export type SortColumn = 'overall' | 'flood' | 'drought' | 'heatwave' | 'cyclone';

/** Panel mode: climate risk score or teleconnection analysis */
export type ClimateProjectionsMode = 'risk' | 'teleconnection';

// ════════════════════════════════════════════════════════════════════════════
// TELECONNECTION TYPES (Req 35.1–35.4)
// ════════════════════════════════════════════════════════════════════════════

/** The three major climate teleconnection drivers for Indian monsoon */
export type TeleconnectionDriver = 'ENSO' | 'IOD' | 'MJO';

/** Phase / state classification for a teleconnection driver */
export type ENSOPhase = 'El Niño' | 'Neutral' | 'La Niña';
export type IODPhase = 'Positive' | 'Neutral' | 'Negative';
export type MJOPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; // Wheel phases 1-8

/** Current index value for each teleconnection driver */
export interface TeleconnectionIndices {
  /** Niño 3.4 SST anomaly (°C). Positive = El Niño, Negative = La Niña */
  enso_nino34: number;
  enso_phase: ENSOPhase;
  /** Dipole Mode Index for IOD (°C). Positive = reduced monsoon rainfall */
  iod_dmi: number;
  iod_phase: IODPhase;
  /** MJO RMM amplitude (>1 = active). Phase 1-8 on the Wheeler-Hendon wheel */
  mjo_amplitude: number;
  mjo_phase: MJOPhase;
  /** Timestamp of the index values */
  timestamp: string;
}

/** A single SST anomaly cell covering ocean regions */
export interface SSTAnomalyCell {
  lat: number;
  lon: number;
  /** SST anomaly in °C (positive = warmer than normal) */
  anomaly: number;
  /** Which ocean basin this cell belongs to */
  basin: 'pacific' | 'indian';
}

/** Historical ENSO/IOD event with its monsoon rainfall impact */
export interface TeleconnectionHistoricalEvent {
  year: number;
  driver: TeleconnectionDriver;
  /** Index value at peak (e.g. Niño 3.4 or DMI) */
  peakIndex: number;
  phase: string;
  /** All-India Summer Monsoon Rainfall as % of Long Period Average */
  ismrPctLPA: number;
  /** Whether the event led to a drought (ISMR < 90% LPA) */
  wasDrought: boolean;
  /** Whether the event led to flood-like excess (ISMR > 110% LPA) */
  wasExcess: boolean;
}

/** Correlated Indian grid cell for a selected teleconnection driver */
export interface CorrelatedCell {
  lat: number;
  lon: number;
  /**
   * Pearson correlation coefficient between driver index and rainfall anomaly.
   * Range [-1, 1].
   */
  correlation: number;
}

// ════════════════════════════════════════════════════════════════════════════
// CLIMATE RISK SCORE — Constants, Pure Functions, Mock Data
// Validates: Requirements 26.1, 26.2, 26.3, 26.4
// ════════════════════════════════════════════════════════════════════════════

/**
 * Weights for composite risk score computation.
 * Must sum to 1.0. Flood and heatwave are weighted highest for India.
 * Requirement 26.1: deterministic weighted combination.
 */
export const HAZARD_WEIGHTS: Readonly<HazardScores> = {
  flood: 0.35,
  drought: 0.25,
  heatwave: 0.25,
  cyclone: 0.15,
};

/** Threshold above which a district is flagged with a warning icon. Req 26.4. */
export const HIGH_RISK_THRESHOLD = 75;

/**
 * Compute the composite Climate Risk Score (0–100) from individual hazard scores.
 * Property 15: composite is in [0,100] and equals a deterministic weighted combination.
 * Validates: Requirement 26.1
 */
export function computeCompositeRiskScore(components: HazardScores): number {
  const raw =
    components.flood     * HAZARD_WEIGHTS.flood +
    components.drought   * HAZARD_WEIGHTS.drought +
    components.heatwave  * HAZARD_WEIGHTS.heatwave +
    components.cyclone   * HAZARD_WEIGHTS.cyclone;
  return Math.min(100, Math.max(0, raw));
}

/** Build a ClimateRiskScore from component scores. Validates: Requirement 26.1 */
export function buildClimateRiskScore(
  district: string,
  state: string,
  components: HazardScores,
): ClimateRiskScore {
  return { district, state, overall: computeCompositeRiskScore(components), components };
}

/** Return true when the district's overall score exceeds 75. Validates: Req 26.4 */
export function isHighRisk(score: ClimateRiskScore): boolean {
  return score.overall > HIGH_RISK_THRESHOLD;
}

/** Sort districts by a column. Returns a new array. */
export function sortDistricts(
  scores: ClimateRiskScore[],
  column: SortColumn = 'overall',
  direction: SortDirection = 'desc',
): ClimateRiskScore[] {
  const getValue = (s: ClimateRiskScore): number =>
    column === 'overall' ? s.overall : s.components[column];
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...scores].sort((a, b) => multiplier * (getValue(a) - getValue(b)));
}

/**
 * Map an overall risk score (0–100) to a CSS colour on a green→yellow→red gradient.
 * Requirement 26.2.
 */
export function riskScoreToColor(score: number): string {
  const s = Math.min(100, Math.max(0, score));
  if (s <= 33) {
    const t = s / 33;
    return `rgb(${Math.round(34 + t * 98)},${Math.round(197 + t * 7)},${Math.round(94 - t * 72)})`;
  }
  if (s <= 66) {
    const t = (s - 33) / 33;
    return `rgb(${Math.round(132 + t * 117)},${Math.round(204 - t * 89)},22)`;
  }
  const t = (s - 66) / 34;
  return `rgb(${Math.round(249 - t * 96)},${Math.round(115 - t * 88)},${Math.round(22 + t * 5)})`;
}

/** Return a human-readable risk category label. */
export function riskCategory(score: number): string {
  if (score <= 25) return 'Low';
  if (score <= 50) return 'Moderate';
  if (score <= 75) return 'High';
  return 'Extreme';
}

/** Representative Indian districts with synthetic hazard scores for demo. */
export const MOCK_DISTRICT_SCORES: ClimateRiskScore[] = [
  buildClimateRiskScore('Puri',       'Odisha',           { flood: 85, drought: 30, heatwave: 72, cyclone: 95 }),
  buildClimateRiskScore('Kendrapara', 'Odisha',           { flood: 90, drought: 25, heatwave: 68, cyclone: 88 }),
  buildClimateRiskScore('Balasore',   'Odisha',           { flood: 78, drought: 28, heatwave: 65, cyclone: 82 }),
  buildClimateRiskScore('Sivasagar',  'Assam',            { flood: 92, drought: 20, heatwave: 55, cyclone: 15 }),
  buildClimateRiskScore('Dibrugarh',  'Assam',            { flood: 88, drought: 22, heatwave: 58, cyclone: 12 }),
  buildClimateRiskScore('Lakhimpur',  'Assam',            { flood: 84, drought: 24, heatwave: 52, cyclone: 10 }),
  buildClimateRiskScore('Nalgonda',   'Telangana',        { flood: 35, drought: 88, heatwave: 90, cyclone:  5 }),
  buildClimateRiskScore('Anantapur',  'Andhra Pradesh',   { flood: 28, drought: 92, heatwave: 88, cyclone:  8 }),
  buildClimateRiskScore('Kurnool',    'Andhra Pradesh',   { flood: 42, drought: 85, heatwave: 86, cyclone: 12 }),
  buildClimateRiskScore('Vidisha',    'Madhya Pradesh',   { flood: 55, drought: 70, heatwave: 82, cyclone:  5 }),
  buildClimateRiskScore('Banda',      'Uttar Pradesh',    { flood: 48, drought: 75, heatwave: 84, cyclone:  4 }),
  buildClimateRiskScore('Ratnagiri',  'Maharashtra',      { flood: 72, drought: 20, heatwave: 55, cyclone: 48 }),
  buildClimateRiskScore('Kannur',     'Kerala',           { flood: 68, drought: 18, heatwave: 45, cyclone: 35 }),
  buildClimateRiskScore('Patna',      'Bihar',            { flood: 78, drought: 42, heatwave: 78, cyclone:  8 }),
  buildClimateRiskScore('Varanasi',   'Uttar Pradesh',    { flood: 62, drought: 48, heatwave: 80, cyclone:  5 }),
  buildClimateRiskScore('Shimla',     'Himachal Pradesh', { flood: 35, drought: 32, heatwave: 22, cyclone:  5 }),
  buildClimateRiskScore('Jaisalmer',  'Rajasthan',        { flood: 12, drought: 96, heatwave: 95, cyclone:  2 }),
  buildClimateRiskScore('Barmer',     'Rajasthan',        { flood: 15, drought: 94, heatwave: 93, cyclone:  4 }),
];

// ════════════════════════════════════════════════════════════════════════════
// TELECONNECTION — Constants, Pure Functions, Mock Data
// Validates: Requirements 35.1, 35.2, 35.3, 35.4
// ════════════════════════════════════════════════════════════════════════════

/**
 * Current teleconnection index values (mock — in production fetched from
 * NOAA/CPC weekly ENSO/IOD/MJO bulletins via backend).
 * Validates: Requirement 35.1
 */
export const MOCK_TELECONNECTION_INDICES: TeleconnectionIndices = {
  enso_nino34: -0.8,
  enso_phase: 'La Niña',
  iod_dmi: 0.4,
  iod_phase: 'Positive',
  mjo_amplitude: 1.6,
  mjo_phase: 3,
  timestamp: new Date().toISOString(),
};

/**
 * Historical ENSO events and their impact on Indian Summer Monsoon Rainfall.
 * Data based on published IMD/NOAA research (1950–2023).
 * Validates: Requirement 35.4
 */
export const HISTORICAL_ENSO_EVENTS: TeleconnectionHistoricalEvent[] = [
  { year: 2015, driver: 'ENSO', peakIndex:  2.6, phase: 'El Niño', ismrPctLPA:  86, wasDrought: true,  wasExcess: false },
  { year: 2009, driver: 'ENSO', peakIndex:  1.2, phase: 'El Niño', ismrPctLPA:  78, wasDrought: true,  wasExcess: false },
  { year: 2002, driver: 'ENSO', peakIndex:  1.5, phase: 'El Niño', ismrPctLPA:  81, wasDrought: true,  wasExcess: false },
  { year: 1997, driver: 'ENSO', peakIndex:  2.8, phase: 'El Niño', ismrPctLPA: 102, wasDrought: false, wasExcess: false },
  { year: 1994, driver: 'ENSO', peakIndex:  1.1, phase: 'El Niño', ismrPctLPA: 110, wasDrought: false, wasExcess: false },
  { year: 2020, driver: 'ENSO', peakIndex: -1.2, phase: 'La Niña', ismrPctLPA: 109, wasDrought: false, wasExcess: false },
  { year: 2010, driver: 'ENSO', peakIndex: -1.5, phase: 'La Niña', ismrPctLPA: 102, wasDrought: false, wasExcess: false },
  { year: 2007, driver: 'ENSO', peakIndex: -1.6, phase: 'La Niña', ismrPctLPA: 106, wasDrought: false, wasExcess: true  },
  { year: 1988, driver: 'ENSO', peakIndex: -2.0, phase: 'La Niña', ismrPctLPA: 126, wasDrought: false, wasExcess: true  },
];

/**
 * Historical IOD events and monsoon impact.
 * Validates: Requirement 35.4
 */
export const HISTORICAL_IOD_EVENTS: TeleconnectionHistoricalEvent[] = [
  { year: 2019, driver: 'IOD', peakIndex:  2.1, phase: 'Positive', ismrPctLPA: 110, wasDrought: false, wasExcess: false },
  { year: 2012, driver: 'IOD', peakIndex:  0.8, phase: 'Positive', ismrPctLPA:  93, wasDrought: false, wasExcess: false },
  { year: 2008, driver: 'IOD', peakIndex: -1.0, phase: 'Negative', ismrPctLPA:  98, wasDrought: false, wasExcess: false },
  { year: 1997, driver: 'IOD', peakIndex:  1.8, phase: 'Positive', ismrPctLPA: 102, wasDrought: false, wasExcess: false },
  { year: 1994, driver: 'IOD', peakIndex: -0.8, phase: 'Negative', ismrPctLPA: 110, wasDrought: false, wasExcess: false },
  { year: 1961, driver: 'IOD', peakIndex:  0.9, phase: 'Positive', ismrPctLPA:  87, wasDrought: true,  wasExcess: false },
];

/**
 * Generate synthetic SST anomaly cells for the Pacific (ENSO) and Indian Ocean (IOD)
 * based on the current index values. In production these come from NOAA SST grids.
 * Validates: Requirement 35.2
 */
export function generateSSTAnomalyCells(indices: TeleconnectionIndices): SSTAnomalyCell[] {
  const cells: SSTAnomalyCell[] = [];

  // Tropical Pacific: 30°S–30°N, 120°E–280°E (represented as 120–280, then normalised)
  for (let lat = -30; lat <= 30; lat += 5) {
    for (let lon = 120; lon <= 280; lon += 5) {
      const normLon = lon > 180 ? lon - 360 : lon;
      const inNino34 = Math.abs(lat) <= 5 && normLon >= -170 && normLon <= -120;
      let anomaly = 0;
      if (inNino34) {
        anomaly = indices.enso_nino34 * (0.8 + Math.random() * 0.4);
      } else {
        const distEq = Math.abs(lat) / 30;
        anomaly = -indices.enso_nino34 * distEq * 0.4 * (Math.random() * 0.5 + 0.5);
      }
      cells.push({ lat, lon: normLon, anomaly: +anomaly.toFixed(2), basin: 'pacific' });
    }
  }

  // Indian Ocean: 30°S–30°N, 40°E–110°E
  for (let lat = -30; lat <= 30; lat += 5) {
    for (let lon = 40; lon <= 110; lon += 5) {
      const isWestern = lon < 75;
      const anomaly = isWestern
        ? indices.iod_dmi * (0.6 + Math.random() * 0.4)
        : -indices.iod_dmi * (0.5 + Math.random() * 0.3);
      cells.push({ lat, lon, anomaly: +anomaly.toFixed(2), basin: 'indian' });
    }
  }

  return cells;
}

/**
 * Map SST anomaly (°C) to a CSS colour on a blue→white→red scale, clamped to ±3°C.
 * Validates: Requirement 35.2
 */
export function sstAnomalyToColor(anomaly: number): string {
  const t = (Math.max(-3, Math.min(3, anomaly)) + 3) / 6;
  if (t < 0.5) {
    const u = t / 0.5;
    return `rgb(${Math.round(20 + u * 235)},${Math.round(80 + u * 175)},${Math.round(200 + u * 55)})`;
  }
  const u = (t - 0.5) / 0.5;
  return `rgb(255,${Math.round(255 - u * 205)},${Math.round(255 - u * 255)})`;
}

/**
 * Classify current ENSO state impact on Indian monsoon.
 */
export function ensoMonsoonImpact(indices: TeleconnectionIndices): string {
  if (indices.enso_nino34 >= 1.0)  return 'Drought risk ↑ (El Niño suppresses monsoon)';
  if (indices.enso_nino34 <= -1.0) return 'Above-normal rainfall likely (La Niña enhances monsoon)';
  return 'Neutral — monsoon not significantly modulated by ENSO';
}

/**
 * Classify current IOD state impact on Indian monsoon.
 */
export function iodMonsoonImpact(indices: TeleconnectionIndices): string {
  if (indices.iod_dmi >= 0.5)  return 'Positive IOD — enhanced moisture transport to India';
  if (indices.iod_dmi <= -0.5) return 'Negative IOD — reduced rainfall risk for India';
  return 'Neutral IOD — limited teleconnection influence';
}

/**
 * Return MJO phase description relevant to Indian rainfall.
 * Phases 2-3: enhanced convection. Phases 6-7: suppressed.
 */
export function mjoPhaseDescription(phase: MJOPhase, amplitude: number): string {
  if (amplitude < 1.0) return 'Weak MJO — low teleconnection influence on Indian rainfall';
  const descriptions: Record<MJOPhase, string> = {
    1: 'Phase 1 — Active convection over W. Africa/Indian Ocean',
    2: 'Phase 2 — Active convection reaching Indian Ocean',
    3: 'Phase 3 — Enhanced rainfall over India & Bay of Bengal',
    4: 'Phase 4 — Active convection over Maritime Continent',
    5: 'Phase 5 — Convection moving to W. Pacific',
    6: 'Phase 6 — Suppressed convection over India',
    7: 'Phase 7 — Dry phase over India & Indian Ocean',
    8: 'Phase 8 — Transition phase — convection rebuilding',
  };
  return descriptions[phase] ?? 'Unknown phase';
}

/**
 * Generate correlated Indian grid cells for a selected driver at 2.5° resolution.
 * Validates: Requirement 35.3
 */
export function generateCorrelatedCells(driver: TeleconnectionDriver): CorrelatedCell[] {
  const cells: CorrelatedCell[] = [];
  for (let lat = 8; lat <= 36; lat += 2.5) {
    for (let lon = 68; lon <= 98; lon += 2.5) {
      let correlation = 0;
      if (driver === 'ENSO') {
        // El Niño → negative correlation; strongest in central/NW India
        const isNE = lon > 88 && lat > 22;
        const base = isNE ? -0.15 : -0.45;
        correlation = base + (Math.random() - 0.5) * 0.25;
      } else if (driver === 'IOD') {
        // Positive IOD → positive correlation; strongest in central/south India
        const isCentral = lat < 25 && lon > 74 && lon < 88;
        const base = isCentral ? 0.40 : 0.20;
        correlation = base + (Math.random() - 0.5) * 0.20;
      } else {
        // MJO phases 2-3 → enhanced rainfall
        const base = lon < 80 ? 0.30 : 0.20;
        correlation = base + (Math.random() - 0.5) * 0.30;
      }
      cells.push({ lat, lon, correlation: +Math.max(-1, Math.min(1, correlation)).toFixed(2) });
    }
  }
  return cells;
}

/**
 * Map correlation coefficient to a diverging CSS colour (blue=negative, red=positive).
 */
export function correlationToColor(r: number): string {
  const c = Math.max(-1, Math.min(1, r));
  if (c >= 0) {
    const u = c;
    return `rgb(255,${Math.round(255 - u * 205)},${Math.round(255 - u * 255)})`;
  }
  const u = -c;
  return `rgb(${Math.round(255 - u * 205)},${Math.round(255 - u * 175)},255)`;
}

// ════════════════════════════════════════════════════════════════════════════
// CLIMATE RISK SCORE — Sub-Components
// ════════════════════════════════════════════════════════════════════════════

const HAZARD_COLORS: Record<keyof HazardScores, string> = {
  flood: '#60a5fa', drought: '#fbbf24', heatwave: '#f97316', cyclone: '#a78bfa',
};

interface ChoroplethProps {
  scores: ClimateRiskScore[];
  onSelect: (score: ClimateRiskScore) => void;
  selectedDistrict: string | null;
}

const ChoroplethGrid: React.FC<ChoroplethProps> = ({ scores, onSelect, selectedDistrict }) => (
  <div
    aria-label="Climate Risk Score Choropleth"
    role="grid"
    style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: '4px', marginBottom: '12px' }}
  >
    {scores.map((s) => {
      const color = riskScoreToColor(s.overall);
      const isSelected = selectedDistrict === s.district;
      const isWarning = isHighRisk(s);
      return (
        <button
          key={`${s.state}-${s.district}`}
          role="gridcell"
          aria-label={`${s.district}, ${s.state}: ${s.overall.toFixed(0)} risk score${isWarning ? ' — HIGH RISK' : ''}`}
          aria-pressed={isSelected}
          title={`${s.district} (${s.state})\nOverall: ${s.overall.toFixed(1)}\nFlood: ${s.components.flood} | Drought: ${s.components.drought} | Heat: ${s.components.heatwave} | Cyclone: ${s.components.cyclone}`}
          onClick={() => onSelect(s)}
          style={{
            background: color,
            border: isSelected ? '2px solid #fff' : isWarning ? '2px solid #fbbf24' : '1px solid rgba(0,0,0,0.2)',
            borderRadius: '4px',
            cursor: 'pointer',
            height: '40px',
            position: 'relative',
            transition: 'transform 150ms ease, box-shadow 150ms ease',
            boxShadow: isSelected ? `0 0 8px ${color}` : 'none',
            outline: 'none',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.12)'; (e.currentTarget as HTMLButtonElement).style.zIndex = '10'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLButtonElement).style.zIndex = '1'; }}
        >
          {isWarning && (
            <span aria-hidden="true" style={{ position: 'absolute', top: '1px', right: '2px', fontSize: '10px', lineHeight: 1, animation: 'warning-blink 1.5s ease-in-out infinite' }}>⚠</span>
          )}
          <span style={{ position: 'absolute', bottom: '1px', left: 0, right: 0, fontSize: '8px', color: 'rgba(0,0,0,0.75)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px', fontWeight: 600 }}>
            {s.district.slice(0, 6)}
          </span>
        </button>
      );
    })}
  </div>
);

const ColorScaleLegend: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a6))' }}>
    <span>Low</span>
    <div aria-hidden="true" style={{ flex: 1, height: '10px', borderRadius: '5px', background: 'linear-gradient(to right, #22c55e, #84cc16, #eab308, #f97316, #ef4444, #991b1b)' }} />
    <span>Extreme</span>
  </div>
);

const HazardBar: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
    <span style={{ width: '54px', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a6))', flexShrink: 0 }}>{label}</span>
    <div style={{ flex: 1, height: '6px', background: 'rgba(var(--fg-rgb),var(--fg-a08))', borderRadius: '3px', overflow: 'hidden' }}>
      <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 400ms ease' }} />
    </div>
    <span style={{ width: '28px', textAlign: 'right', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a7))', flexShrink: 0 }}>{value}</span>
  </div>
);

const SortableHeader: React.FC<{ col: SortColumn; label: string; current: SortColumn; direction: SortDirection; onSort: (col: SortColumn) => void }> = ({ col, label, current, direction, onSort }) => (
  <th
    scope="col"
    onClick={() => onSort(col)}
    aria-sort={current === col ? (direction === 'desc' ? 'descending' : 'ascending') : 'none'}
    style={{ padding: '6px 8px', textAlign: col === 'overall' ? 'left' : 'center', fontSize: '11px', fontWeight: 600, color: current === col ? 'rgba(var(--fg-rgb),var(--fg-a75))' : 'rgba(var(--fg-rgb),var(--fg-a4))', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(var(--fg-rgb),var(--fg-a1))' }}
  >
    {label}{current === col && <span aria-hidden="true" style={{ marginLeft: '4px' }}>{direction === 'desc' ? '▼' : '▲'}</span>}
  </th>
);

interface RankedTableProps {
  scores: ClimateRiskScore[];
  selectedDistrict: string | null;
  onSelect: (score: ClimateRiskScore) => void;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (col: SortColumn) => void;
}

const RankedTable: React.FC<RankedTableProps> = ({ scores, selectedDistrict, onSelect, sortColumn, sortDirection, onSort }) => (
  <div style={{ overflowY: 'auto', maxHeight: '320px' }} role="region" aria-label="Ranked district climate risk scores">
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
      <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
        <tr>
          <th scope="col" style={{ padding: '6px 8px', textAlign: 'center', width: '32px', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', borderBottom: '1px solid rgba(var(--fg-rgb),var(--fg-a1))' }}>#</th>
          <SortableHeader col="overall"  label="District" current={sortColumn} direction={sortDirection} onSort={onSort} />
          <SortableHeader col="overall"  label="Score"    current={sortColumn} direction={sortDirection} onSort={onSort} />
          <SortableHeader col="flood"    label="Flood"    current={sortColumn} direction={sortDirection} onSort={onSort} />
          <SortableHeader col="drought"  label="Drought"  current={sortColumn} direction={sortDirection} onSort={onSort} />
          <SortableHeader col="heatwave" label="Heat"     current={sortColumn} direction={sortDirection} onSort={onSort} />
          <SortableHeader col="cyclone"  label="Cyclone"  current={sortColumn} direction={sortDirection} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {scores.map((s, idx) => {
          const isSelected = selectedDistrict === s.district;
          const isWarning = isHighRisk(s);
          const rowColor = riskScoreToColor(s.overall);
          return (
            <tr
              key={`${s.state}-${s.district}`}
              onClick={() => onSelect(s)}
              aria-selected={isSelected}
              style={{ cursor: 'pointer', background: isSelected ? 'rgba(var(--fg-rgb),var(--fg-a08))' : idx % 2 === 0 ? 'rgba(var(--fg-rgb),var(--fg-a05))' : 'transparent', borderLeft: isSelected ? `3px solid ${rowColor}` : '3px solid transparent', transition: 'background 150ms ease' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'rgba(var(--fg-rgb),var(--fg-a05))')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = isSelected ? 'rgba(var(--fg-rgb),var(--fg-a08))' : idx % 2 === 0 ? 'rgba(var(--fg-rgb),var(--fg-a05))' : 'transparent')}
            >
              <td style={{ padding: '5px 8px', textAlign: 'center', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>{idx + 1}</td>
              <td style={{ padding: '5px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  {isWarning && <span aria-label="High risk warning" style={{ animation: 'warning-blink 1.5s ease-in-out infinite', fontSize: '12px' }}>⚠️</span>}
                  <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a75))', fontWeight: 500 }}>{s.district}</span>
                  <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontSize: '10px' }}>{s.state}</span>
                </div>
              </td>
              <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                <span style={{ background: `${rowColor}25`, border: `1px solid ${rowColor}`, borderRadius: '4px', color: rowColor, fontWeight: 600, fontSize: '11px', padding: '1px 6px' }}>{s.overall.toFixed(0)}</span>
              </td>
              {(['flood', 'drought', 'heatwave', 'cyclone'] as (keyof HazardScores)[]).map((h) => (
                <td key={h} style={{ padding: '5px 8px', textAlign: 'center' }}>
                  <span style={{ color: HAZARD_COLORS[h], fontWeight: 500 }}>{s.components[h]}</span>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const DistrictDetailCard: React.FC<{ score: ClimateRiskScore }> = ({ score }) => {
  const color = riskScoreToColor(score.overall);
  const warning = isHighRisk(score);
  return (
    <div style={{ background: `${color}12`, border: `1px solid ${color}50`, borderRadius: '8px', padding: '12px', marginTop: '12px', animation: warning ? 'risk-card-pulse 2s ease-in-out infinite' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div>
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'rgba(var(--fg-rgb),var(--fg-a75))' }}>{warning && <span aria-label="High risk warning">⚠️ </span>}{score.district}</span>
          <span style={{ marginLeft: '8px', fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>{score.state}</span>
        </div>
        <span style={{ fontSize: '22px', fontWeight: 700, color }}>{score.overall.toFixed(1)}<span style={{ fontSize: '12px', marginLeft: '4px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>/ 100</span></span>
      </div>
      <div style={{ fontSize: '12px', color, fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{riskCategory(score.overall)} Risk</div>
      <HazardBar label="Flood"   value={score.components.flood}    color={HAZARD_COLORS.flood} />
      <HazardBar label="Drought" value={score.components.drought}  color={HAZARD_COLORS.drought} />
      <HazardBar label="Heat"    value={score.components.heatwave} color={HAZARD_COLORS.heatwave} />
      <HazardBar label="Cyclone" value={score.components.cyclone}  color={HAZARD_COLORS.cyclone} />
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// TELECONNECTION — Sub-Components
// ════════════════════════════════════════════════════════════════════════════

/** Index badge showing current value, phase, and trend arrow. Validates: Req 35.1 */
interface IndexBadgeProps {
  label: string; acronym: string; value: number; phase: string; unit: string;
  positiveColor: string; negativeColor: string; neutralColor?: string; description: string;
}

const IndexBadge: React.FC<IndexBadgeProps> = ({ label, acronym, value, phase, unit, positiveColor, negativeColor, neutralColor = '#94a3b8', description }) => {
  const absVal = Math.abs(value);
  const color = absVal < 0.5 ? neutralColor : value > 0 ? positiveColor : negativeColor;
  const arrow = value > 0.3 ? '↑' : value < -0.3 ? '↓' : '↔';
  return (
    <div title={description} aria-label={`${label}: ${value.toFixed(2)} ${unit}, phase ${phase}`}
      style={{ flex: 1, minWidth: '90px', background: `${color}18`, border: `1px solid ${color}60`, borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(var(--fg-rgb),var(--fg-a4))', letterSpacing: '0.08em', marginBottom: '2px' }}>{acronym}</div>
      <div style={{ fontSize: '20px', fontWeight: 800, color, lineHeight: 1 }}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}<span style={{ fontSize: '10px', marginLeft: '2px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>{unit}</span>
      </div>
      <div style={{ fontSize: '11px', color, fontWeight: 600, marginTop: '3px' }}>{arrow} {phase}</div>
    </div>
  );
};

/** SST Anomaly mini-map as a CSS grid. Validates: Req 35.2 */
interface SSTMapProps { cells: SSTAnomalyCell[]; basin: 'pacific' | 'indian'; title: string; }

const SSTAnomalyMap: React.FC<SSTMapProps> = ({ cells, basin, title }) => {
  const filtered = cells.filter((c) => c.basin === basin);
  if (filtered.length === 0) return null;
  const lats = [...new Set(filtered.map((c) => c.lat))].sort((a, b) => b - a);
  const lons = [...new Set(filtered.map((c) => c.lon))].sort((a, b) => a - b);
  const cellMap = new Map(filtered.map((c) => [`${c.lat}_${c.lon}`, c]));
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      <div role="img" aria-label={`${title} SST anomaly map`} style={{ display: 'grid', gridTemplateColumns: `repeat(${lons.length}, 1fr)`, gap: '1px', borderRadius: '4px', overflow: 'hidden' }}>
        {lats.map((lat) => lons.map((lon) => {
          const cell = cellMap.get(`${lat}_${lon}`);
          return <div key={`${lat}_${lon}`} title={cell ? `${lat}°, ${lon}°: ${cell.anomaly >= 0 ? '+' : ''}${cell.anomaly.toFixed(1)}°C` : ''} style={{ height: '7px', background: cell ? sstAnomalyToColor(cell.anomaly) : 'rgba(var(--fg-rgb),var(--fg-a05))' }} />;
        }))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
        <span style={{ fontSize: '9px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>−3°C</span>
        <div style={{ flex: 1, height: '5px', borderRadius: '3px', background: 'linear-gradient(to right, rgb(20,80,200), #fff, rgb(255,50,0))' }} />
        <span style={{ fontSize: '9px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>+3°C</span>
      </div>
    </div>
  );
};

/** India correlation map. Validates: Req 35.3 */
interface IndiaCorrelationMapProps { cells: CorrelatedCell[]; driver: TeleconnectionDriver; }

const IndiaCorrelationMap: React.FC<IndiaCorrelationMapProps> = ({ cells, driver }) => {
  const lats = [...new Set(cells.map((c) => c.lat))].sort((a, b) => b - a);
  const lons = [...new Set(cells.map((c) => c.lon))].sort((a, b) => a - b);
  const cellMap = new Map(cells.map((c) => [`${c.lat}_${c.lon}`, c]));
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>India Rainfall Correlation — {driver}</div>
      <div role="img" aria-label={`India grid cells correlation with ${driver}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${lons.length}, 1fr)`, gap: '2px', borderRadius: '4px', overflow: 'hidden' }}>
        {lats.map((lat) => lons.map((lon) => {
          const cell = cellMap.get(`${lat}_${lon}`);
          return <div key={`${lat}_${lon}`} title={cell ? `${lat}°N, ${lon}°E: r=${cell.correlation >= 0 ? '+' : ''}${cell.correlation.toFixed(2)}` : ''} style={{ height: '10px', background: cell ? correlationToColor(cell.correlation) : 'rgba(var(--fg-rgb),var(--fg-a05))', borderRadius: '1px' }} />;
        }))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
        <span style={{ fontSize: '9px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>−1 (suppressed)</span>
        <div style={{ flex: 1, height: '5px', borderRadius: '3px', background: 'linear-gradient(to right, rgb(50,80,255), #fff, rgb(255,50,50))' }} />
        <span style={{ fontSize: '9px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>+1 (enhanced)</span>
      </div>
    </div>
  );
};

/** Historical correlation bar chart. Validates: Req 35.4 */
interface HistoricalChartProps { events: TeleconnectionHistoricalEvent[]; driver: TeleconnectionDriver; }

const HistoricalCorrelationChart: React.FC<HistoricalChartProps> = ({ events, driver }) => {
  if (events.length === 0) return null;
  const LPA = 100;
  const sorted = [...events].sort((a, b) => a.year - b.year);
  const allVals = sorted.map((e) => e.ismrPctLPA);
  const minVal = Math.min(...allVals, 75);
  const maxVal = Math.max(...allVals, 115);
  const range = maxVal - minVal;
  const chartH = 130;
  const barW = Math.max(16, Math.min(28, Math.floor(280 / sorted.length) - 3));
  const padLeft = 36;
  const padBottom = 24;
  const plotH = chartH - padBottom - 8;
  const yToSvg = (val: number): number => 8 + plotH - ((val - minVal) / range) * plotH;
  const totalWidth = padLeft + sorted.length * (barW + 3) + 8;

  return (
    <div>
      <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Historical {driver} Impact on Indian Monsoon (ISMR % LPA)
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={totalWidth} height={chartH} role="img" aria-label={`Historical ${driver} events and India monsoon rainfall`} style={{ display: 'block' }}>
          <line x1={padLeft} y1={yToSvg(LPA)} x2={totalWidth - 4} y2={yToSvg(LPA)} stroke="rgba(var(--fg-rgb),var(--fg-a3))" strokeWidth="1" strokeDasharray="4 3" />
          <text x={padLeft - 4} y={yToSvg(LPA) + 4} textAnchor="end" fontSize="8" fill="rgba(var(--fg-rgb),var(--fg-a4))">LPA</text>
          {[75, 90, 100, 110, 125].map((val) => {
            const y = yToSvg(val);
            if (y < 4 || y > chartH - padBottom) return null;
            return <g key={val}><line x1={padLeft} y1={y} x2={totalWidth - 4} y2={y} stroke="rgba(var(--fg-rgb),var(--fg-a05))" strokeWidth="1" /><text x={padLeft - 4} y={y + 4} textAnchor="end" fontSize="8" fill="rgba(var(--fg-rgb),var(--fg-a3))">{val}</text></g>;
          })}
          {sorted.map((ev, i) => {
            const x = padLeft + i * (barW + 3) + 2;
            const barColor = ev.wasDrought ? '#f87171' : ev.wasExcess ? '#60a5fa' : '#94a3b8';
            const barTop = yToSvg(ev.ismrPctLPA);
            const barBase = yToSvg(LPA);
            const barY = Math.min(barTop, barBase);
            const barH = Math.abs(barTop - barBase);
            return (
              <g key={ev.year}>
                <rect x={x} y={barY} width={barW} height={Math.max(2, barH)} fill={barColor} rx="2" opacity={0.85}>
                  <title>{ev.year}: {ev.phase}, ISMR={ev.ismrPctLPA}% LPA, Peak={ev.peakIndex >= 0 ? '+' : ''}{ev.peakIndex.toFixed(1)}</title>
                </rect>
                <text x={x + barW / 2} y={chartH - padBottom + 13} textAnchor="middle" fontSize="8" fill="rgba(var(--fg-rgb),var(--fg-a4))">{ev.year}</text>
              </g>
            );
          })}
          <line x1={padLeft} y1={8} x2={padLeft} y2={chartH - padBottom} stroke="rgba(var(--fg-rgb),var(--fg-a15))" strokeWidth="1" />
          <line x1={padLeft} y1={chartH - padBottom} x2={totalWidth - 4} y2={chartH - padBottom} stroke="rgba(var(--fg-rgb),var(--fg-a15))" strokeWidth="1" />
        </svg>
      </div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '9px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginTop: '4px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><span style={{ width: '8px', height: '8px', background: '#f87171', borderRadius: '2px', display: 'inline-block' }} /> Drought (&lt;90% LPA)</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><span style={{ width: '8px', height: '8px', background: '#60a5fa', borderRadius: '2px', display: 'inline-block' }} /> Excess (&gt;110% LPA)</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><span style={{ width: '8px', height: '8px', background: '#94a3b8', borderRadius: '2px', display: 'inline-block' }} /> Normal</span>
      </div>
    </div>
  );
};

/** Wheeler-Hendon MJO phase wheel as an SVG compass. Validates: Req 35.1 */
const MJOWheel: React.FC<{ phase: MJOPhase; amplitude: number }> = ({ phase, amplitude }) => {
  const size = 120; const cx = size / 2; const cy = size / 2; const R = 46;
  const isActive = amplitude >= 1.0;
  const phaseLabels: Record<MJOPhase, string> = { 1: 'Africa', 2: 'W.IO', 3: 'IO', 4: 'MC', 5: 'W.Pac', 6: 'C.Pac', 7: 'E.Pac', 8: 'W.Hem' };
  const phaseColors: Record<MJOPhase, string> = { 1: '#94a3b8', 2: '#60a5fa', 3: '#34d399', 4: '#a78bfa', 5: '#f59e0b', 6: '#f97316', 7: '#ef4444', 8: '#fb923c' };
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>MJO Wheel — RMM Amplitude: {amplitude.toFixed(1)}</div>
      <svg width={size} height={size} role="img" aria-label={`MJO phase wheel, current phase ${phase}, amplitude ${amplitude.toFixed(1)}`}>
        <circle cx={cx} cy={cy} r={R} fill="rgba(var(--fg-rgb),var(--fg-a05))" stroke="rgba(var(--fg-rgb),var(--fg-a08))" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={R * 0.65} fill="none" stroke="rgba(var(--fg-rgb),var(--fg-a12))" strokeWidth="1" strokeDasharray="3 3" />
        {([1,2,3,4,5,6,7,8] as MJOPhase[]).map((p) => {
          const startAngle = ((p - 1) * 45 - 90) * (Math.PI / 180);
          const endAngle   = (p * 45 - 90) * (Math.PI / 180);
          const midAngle   = ((p - 0.5) * 45 - 90) * (Math.PI / 180);
          const isActive_p = p === phase;
          const color = phaseColors[p];
          const x1 = cx + R * Math.cos(startAngle); const y1 = cy + R * Math.sin(startAngle);
          const x2 = cx + R * Math.cos(endAngle);   const y2 = cy + R * Math.sin(endAngle);
          const tx = cx + (R + 10) * Math.cos(midAngle); const ty = cy + (R + 10) * Math.sin(midAngle);
          return (
            <g key={p}>
              <path d={`M${cx},${cy} L${x1},${y1} A${R},${R} 0 0,1 ${x2},${y2} Z`} fill={isActive_p ? `${color}55` : `${color}12`} stroke={isActive_p ? color : 'rgba(var(--fg-rgb),var(--fg-a08))'} strokeWidth={isActive_p ? 1.5 : 0.5} />
              <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize="7" fontWeight={isActive_p ? '700' : '400'} fill={isActive_p ? color : 'rgba(var(--fg-rgb),var(--fg-a3))'}>{phaseLabels[p]}</text>
            </g>
          );
        })}
        {isActive && (() => {
          const angle = ((phase - 0.5) * 45 - 90) * (Math.PI / 180);
          const len = Math.min(R - 4, amplitude * (R * 0.65) * 0.6);
          return <line x1={cx} y1={cy} x2={cx + len * Math.cos(angle)} y2={cy + len * Math.sin(angle)} stroke={phaseColors[phase]} strokeWidth="2" strokeLinecap="round" />;
        })()}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="rgba(var(--fg-rgb),var(--fg-a4))" fontWeight="600">{isActive ? `P${phase}` : 'Weak'}</text>
      </svg>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// TELECONNECTION PANEL — Main Component
// Validates: Requirements 35.1, 35.2, 35.3, 35.4
// ════════════════════════════════════════════════════════════════════════════

export interface TeleconnectionPanelProps {
  /** Current teleconnection indices; uses mock when omitted */
  indices?: TeleconnectionIndices;
  /** Called when user selects a driver — consumers can update the globe */
  onDriverSelect?: (driver: TeleconnectionDriver, correlatedCells: CorrelatedCell[]) => void;
  /** Whether this panel is active */
  enabled?: boolean;
}

/**
 * TeleconnectionPanel — Climate Teleconnection Visualization.
 *   35.1 — Displays ENSO, IOD, MJO index values
 *   35.2 — Renders SST anomaly patterns in Pacific/Indian Ocean
 *   35.3 — Highlights correlated Indian grid cells for selected driver
 *   35.4 — Shows historical correlation charts for ENSO/IOD events
 */
export const TeleconnectionPanel: React.FC<TeleconnectionPanelProps> = ({
  indices,
  onDriverSelect,
  enabled = true,
}) => {
  const [selectedDriver, setSelectedDriver] = useState<TeleconnectionDriver>('ENSO');
  const idx = indices ?? MOCK_TELECONNECTION_INDICES;

  const sstCells = useMemo(() => generateSSTAnomalyCells(idx), [idx]);
  const correlatedCells = useMemo(() => generateCorrelatedCells(selectedDriver), [selectedDriver]);

  const historicalEvents = useMemo<TeleconnectionHistoricalEvent[]>(() => {
    if (selectedDriver === 'ENSO') return HISTORICAL_ENSO_EVENTS;
    if (selectedDriver === 'IOD')  return HISTORICAL_IOD_EVENTS;
    return [];
  }, [selectedDriver]);

  const handleDriverSelect = useCallback((driver: TeleconnectionDriver) => {
    setSelectedDriver(driver);
    onDriverSelect?.(driver, generateCorrelatedCells(driver));
  }, [onDriverSelect]);

  const impactText = useMemo(() => {
    if (selectedDriver === 'ENSO') return ensoMonsoonImpact(idx);
    if (selectedDriver === 'IOD')  return iodMonsoonImpact(idx);
    return mjoPhaseDescription(idx.mjo_phase, idx.mjo_amplitude);
  }, [selectedDriver, idx]);

  const impactColor = impactText.toLowerCase().match(/drought|suppress|dry/) ? '#f87171'
    : impactText.toLowerCase().match(/above-normal|enhanced|excess/) ? '#34d399'
    : '#94a3b8';

  if (!enabled) return null;

  return (
    <div className="teleconnection-panel" data-testid="teleconnection-panel" role="region" aria-label="Climate Teleconnection Visualization">
      <GlassPanel padding="md">
        {/* Header */}
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'rgba(var(--fg-rgb),var(--fg-a75))', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🌊 Climate Teleconnections
          <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>ENSO · IOD · MJO</span>
        </h3>

        {/* Index Badges — Req 35.1 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <IndexBadge label="El Niño Southern Oscillation" acronym="ENSO" value={idx.enso_nino34} phase={idx.enso_phase} unit="°C" positiveColor="#f87171" negativeColor="#60a5fa" description="Niño 3.4 SST anomaly (°C). El Niño >+0.5, La Niña <-0.5" />
          <IndexBadge label="Indian Ocean Dipole" acronym="IOD" value={idx.iod_dmi} phase={idx.iod_phase} unit="°C" positiveColor="#f59e0b" negativeColor="#818cf8" description="Dipole Mode Index (°C). Positive IOD typically enhances Indian rainfall" />
          <IndexBadge label="Madden-Julian Oscillation" acronym="MJO" value={idx.mjo_amplitude} phase={`Phase ${idx.mjo_phase}`} unit="" positiveColor="#34d399" negativeColor="#94a3b8" neutralColor="#94a3b8" description="RMM amplitude. >1.0 = active MJO. Phase 3 enhances Indian rainfall" />
        </div>

        {/* Impact summary */}
        <div aria-live="polite" style={{ background: `${impactColor}15`, border: `1px solid ${impactColor}50`, borderRadius: '6px', padding: '7px 10px', fontSize: '12px', color: impactColor, marginBottom: '14px', fontWeight: 500 }}>
          {impactText}
        </div>

        {/* Driver tabs */}
        <div role="tablist" aria-label="Select teleconnection driver" style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {(['ENSO', 'IOD', 'MJO'] as TeleconnectionDriver[]).map((d) => (
            <button key={d} role="tab" aria-selected={selectedDriver === d} onClick={() => handleDriverSelect(d)}
              style={{ flex: 1, padding: '5px 0', background: selectedDriver === d ? 'rgba(var(--fg-rgb),var(--fg-a12))' : 'rgba(var(--fg-rgb),var(--fg-a05))', border: selectedDriver === d ? '1px solid rgba(var(--fg-rgb),var(--fg-a3))' : '1px solid rgba(var(--fg-rgb),var(--fg-a08))', borderRadius: '6px', color: selectedDriver === d ? 'rgba(var(--fg-rgb),var(--fg-a75))' : 'rgba(var(--fg-rgb),var(--fg-a4))', fontSize: '12px', fontWeight: selectedDriver === d ? 700 : 400, cursor: 'pointer', transition: 'all 180ms ease' }}>
              {d}
            </button>
          ))}
        </div>

        {/* SST Anomaly Maps — Req 35.2 */}
        {selectedDriver === 'ENSO' && <SSTAnomalyMap cells={sstCells} basin="pacific" title="Pacific Ocean SST Anomaly (ENSO)" />}
        {selectedDriver === 'IOD'  && <SSTAnomalyMap cells={sstCells} basin="indian" title="Indian Ocean SST Anomaly (IOD)" />}
        {selectedDriver === 'MJO'  && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            <MJOWheel phase={idx.mjo_phase} amplitude={idx.mjo_amplitude} />
          </div>
        )}

        {/* India Correlation Map — Req 35.3 */}
        <IndiaCorrelationMap cells={correlatedCells} driver={selectedDriver} />

        {/* Historical Chart — Req 35.4 */}
        {historicalEvents.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(var(--fg-rgb),var(--fg-a08))', paddingTop: '10px', marginTop: '6px' }}>
            <HistoricalCorrelationChart events={historicalEvents} driver={selectedDriver} />
          </div>
        )}
        {selectedDriver === 'MJO' && (
          <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', textAlign: 'center', marginTop: '6px' }}>
            MJO operates on 30–90 day timescales — historical per-event analysis not shown.
          </div>
        )}
      </GlassPanel>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// CLIMATE PROJECTIONS — Main Component (tabbed: Risk Score + Teleconnection)
// ════════════════════════════════════════════════════════════════════════════

export interface ClimateProjectionsProps {
  /** Array of district risk scores; falls back to mock data when omitted */
  districtScores?: ClimateRiskScore[];
  /** Whether the panel is enabled */
  enabled?: boolean;
  /** Callback invoked when the user selects a district. Validates: Req 26.4 */
  onDistrictSelect?: (score: ClimateRiskScore) => void;
  /** Teleconnection indices to display in teleconnection mode. Validates: Req 35.1 */
  teleconnectionIndices?: TeleconnectionIndices;
  /** Called when user selects a teleconnection driver. Validates: Req 35.3 */
  onDriverSelect?: (driver: TeleconnectionDriver, correlatedCells: CorrelatedCell[]) => void;
  /** Initial mode: 'risk' or 'teleconnection' */
  initialMode?: ClimateProjectionsMode;
}

/**
 * ClimateProjections — tabbed panel combining:
 *  - Climate Risk Score Dashboard (Req 26.1–26.4)
 *  - Climate Teleconnection Visualization (Req 35.1–35.4)
 */
export const ClimateProjections: React.FC<ClimateProjectionsProps> = ({
  districtScores,
  enabled = true,
  onDistrictSelect,
  teleconnectionIndices,
  onDriverSelect,
  initialMode = 'risk',
}) => {
  const [mode, setMode] = useState<ClimateProjectionsMode>(initialMode);
  const [sortColumn, setSortColumn] = useState<SortColumn>('overall');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  const rawScores = districtScores ?? MOCK_DISTRICT_SCORES;
  const sorted = useMemo(() => sortDistricts(rawScores, sortColumn, sortDirection), [rawScores, sortColumn, sortDirection]);
  const highRiskCount = useMemo(() => rawScores.filter(isHighRisk).length, [rawScores]);
  const selectedScore = useMemo(() => selectedDistrict ? sorted.find((s) => s.district === selectedDistrict) ?? null : null, [sorted, selectedDistrict]);

  const handleSort = (col: SortColumn) => {
    if (col === sortColumn) { setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc')); }
    else { setSortColumn(col); setSortDirection('desc'); }
  };

  const handleSelect = (score: ClimateRiskScore) => {
    setSelectedDistrict((prev) => prev === score.district ? null : score.district);
    onDistrictSelect?.(score);
  };

  if (!enabled) return null;

  return (
    <div className="climate-projections" data-testid="climate-projections" role="region" aria-label="Climate Analysis Panel">
      {/* Mode tabs */}
      <div role="tablist" aria-label="Climate analysis mode" style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        {([
          { id: 'risk' as ClimateProjectionsMode,           label: '🌡️ Risk Score',       desc: 'District climate risk scores' },
          { id: 'teleconnection' as ClimateProjectionsMode, label: '🌊 Teleconnections', desc: 'ENSO, IOD, MJO analysis' },
        ]).map(({ id, label, desc }) => (
          <button key={id} role="tab" aria-selected={mode === id} aria-label={desc} onClick={() => setMode(id)}
            style={{ flex: 1, padding: '6px 0', background: mode === id ? 'rgba(var(--fg-rgb),var(--fg-a1))' : 'rgba(var(--fg-rgb),var(--fg-a05))', border: mode === id ? '1px solid rgba(var(--fg-rgb),var(--fg-a3))' : '1px solid rgba(var(--fg-rgb),var(--fg-a08))', borderRadius: '6px', color: mode === id ? 'rgba(var(--fg-rgb),var(--fg-a75))' : 'rgba(var(--fg-rgb),var(--fg-a4))', fontSize: '12px', fontWeight: mode === id ? 700 : 400, cursor: 'pointer', transition: 'all 200ms cubic-bezier(0.4,0,0.2,1)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Teleconnection mode */}
      {mode === 'teleconnection' && (
        <TeleconnectionPanel indices={teleconnectionIndices} onDriverSelect={onDriverSelect} enabled={true} />
      )}

      {/* Risk score mode */}
      {mode === 'risk' && (<>
        {highRiskCount > 0 && (
          <div className="climate-risk-banner" role="alert" aria-live="polite"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', animation: 'risk-banner-pulse 2.5s ease-in-out infinite' }}>
            <span style={{ fontSize: '18px' }} aria-hidden="true">🗺️</span>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#fca5a5' }}>
              {highRiskCount} district{highRiskCount > 1 ? 's' : ''} at Extreme Risk (score &gt; 75)
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>Flagged on globe ⚠</span>
          </div>
        )}

        <GlassPanel padding="md" className="climate-risk-panel">
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(var(--fg-rgb),var(--fg-a75))', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🌡️ Climate Risk Score Dashboard
            <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>{rawScores.length} districts</span>
          </h3>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {(Object.keys(HAZARD_WEIGHTS) as (keyof HazardScores)[]).map((h) => (
              <span key={h} style={{ background: `${HAZARD_COLORS[h]}18`, border: `1px solid ${HAZARD_COLORS[h]}60`, borderRadius: '9999px', color: HAZARD_COLORS[h], fontSize: '10px', fontWeight: 600, padding: '2px 8px', textTransform: 'capitalize' }}>
                {h} {(HAZARD_WEIGHTS[h] * 100).toFixed(0)}%
              </span>
            ))}
          </div>

          <ColorScaleLegend />
          <ChoroplethGrid scores={sorted} onSelect={handleSelect} selectedDistrict={selectedDistrict} />
          <RankedTable scores={sorted} selectedDistrict={selectedDistrict} onSelect={handleSelect} sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
          {selectedScore && <DistrictDetailCard score={selectedScore} />}
        </GlassPanel>

        <style>{`
          @keyframes warning-blink { 0%,100%{opacity:1} 50%{opacity:0.35} }
          @keyframes risk-banner-pulse { 0%,100%{box-shadow:0 0 5px rgba(239,68,68,0.25)} 50%{box-shadow:0 0 16px rgba(239,68,68,0.6)} }
          @keyframes risk-card-pulse  { 0%,100%{box-shadow:0 0 4px rgba(239,68,68,0.2)}  50%{box-shadow:0 0 12px rgba(239,68,68,0.5)} }
        `}</style>
      </>)}
    </div>
  );
};

export default ClimateProjections;
