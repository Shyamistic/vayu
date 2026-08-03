/**
 * AQIPanel — Air Quality Index (AQI) Integration Panel.
 *
 * Exports pure functions for AQI classification and color mapping (testable),
 * plus a React component that:
 *  1. Fetches PM2.5, PM10, O3, NO2, SO2 from Open-Meteo Air Quality API
 *  2. Renders a color-coded grid overlay using the standard AQI scale
 *  3. Generates alerts when AQI > 200 (Very Unhealthy)
 *  4. Displays a wind-AQI correlation panel
 *
 * Validates: Requirements 23.1, 23.2, 23.3, 23.4
 */

import React, { useEffect, useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, RegionId } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Standard AQI categories per US EPA / India CPCB scale */
export type AQICategory =
  | 'Good'
  | 'Moderate'
  | 'Unhealthy for Sensitive Groups'
  | 'Unhealthy'
  | 'Very Unhealthy'
  | 'Hazardous';

/** AQI pollutant concentrations for a grid point */
export interface AQIPollutants {
  pm2_5: number;   // μg/m³
  pm10: number;    // μg/m³
  o3: number;      // μg/m³
  no2: number;     // μg/m³
  so2: number;     // μg/m³
}

/** AQI data for a single grid cell */
export interface AQIGridCell {
  lat: number;
  lon: number;
  aqi: number;
  category: AQICategory;
  /** CSS hex/rgb color for the grid overlay */
  color: string;
  pollutants: AQIPollutants;
  /** Dominant pollutant driving the AQI */
  dominantPollutant: keyof AQIPollutants;
}

/** Alert generated when AQI > 200 */
export interface AQIAlert {
  lat: number;
  lon: number;
  aqi: number;
  category: AQICategory;
  dominantPollutant: keyof AQIPollutants;
  message: string;
}

/** Wind-AQI correlation data point */
export interface WindAQICorrelation {
  windSpeed: number;      // m/s
  aqi: number;
  windDirection: number;  // degrees 0–360
  lat: number;
  lon: number;
}

// ── AQI Scale Constants ───────────────────────────────────────────────────────

/** AQI breakpoints and associated category + color */
export interface AQIBreakpoint {
  min: number;
  max: number;
  category: AQICategory;
  /** CSS color for the overlay */
  color: string;
  /** Background color (semi-transparent) */
  bgColor: string;
}

/**
 * Standard AQI breakpoints (US EPA / CPCB scale).
 * Requirement 23.2: standard AQI scale Good → Hazardous.
 */
export const AQI_BREAKPOINTS: AQIBreakpoint[] = [
  { min: 0,   max: 50,  category: 'Good',                           color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)'   },
  { min: 51,  max: 100, category: 'Moderate',                       color: '#eab308', bgColor: 'rgba(234,179,8,0.15)'   },
  { min: 101, max: 150, category: 'Unhealthy for Sensitive Groups',  color: '#f97316', bgColor: 'rgba(249,115,22,0.15)'  },
  { min: 151, max: 200, category: 'Unhealthy',                       color: '#ef4444', bgColor: 'rgba(239,68,68,0.15)'   },
  { min: 201, max: 300, category: 'Very Unhealthy',                  color: '#a855f7', bgColor: 'rgba(168,85,247,0.15)'  },
  { min: 301, max: 500, category: 'Hazardous',                       color: '#7f1d1d', bgColor: 'rgba(127,29,29,0.15)'   },
];

/** AQI alert threshold per Requirement 23.3 */
export const AQI_ALERT_THRESHOLD = 200;

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Classify AQI value into a category using standard breakpoints.
 * Values above 500 are clamped to 'Hazardous'.
 *
 * Requirement 23.2: standard AQI scale.
 */
export function classifyAQI(aqi: number): AQICategory {
  const clamped = Math.max(0, aqi);
  const bp = AQI_BREAKPOINTS.find((b) => clamped >= b.min && clamped <= b.max);
  return bp ? bp.category : 'Hazardous';
}

/**
 * Map an AQI value to a CSS color string.
 * Returns the color of the matching breakpoint band.
 *
 * Requirement 23.2: color-coded grid overlay.
 */
export function aqiToColor(aqi: number): string {
  const clamped = Math.max(0, aqi);
  const bp = AQI_BREAKPOINTS.find((b) => clamped >= b.min && clamped <= b.max);
  return bp ? bp.color : AQI_BREAKPOINTS[AQI_BREAKPOINTS.length - 1].color;
}

/**
 * Return the AQIBreakpoint entry for a given AQI value.
 */
export function getAQIBreakpoint(aqi: number): AQIBreakpoint {
  const clamped = Math.max(0, aqi);
  return (
    AQI_BREAKPOINTS.find((b) => clamped >= b.min && clamped <= b.max) ??
    AQI_BREAKPOINTS[AQI_BREAKPOINTS.length - 1]
  );
}

/**
 * Sub-index computation for PM2.5 using US EPA piecewise linear formula.
 * Breakpoints: 0→0, 12→50, 35.4→100, 55.4→150, 150.4→200, 250.4→300, 350.4→400, 500.4→500
 */
export function pm25SubIndex(c: number): number {
  const bps: [number, number, number, number][] = [
    [0,     12,    0,   50 ],
    [12.1,  35.4,  51,  100],
    [35.5,  55.4,  101, 150],
    [55.5,  150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400],
    [350.5, 500.4, 401, 500],
  ];
  return piecewiseLinear(c, bps);
}

/**
 * Sub-index computation for PM10.
 */
export function pm10SubIndex(c: number): number {
  const bps: [number, number, number, number][] = [
    [0,    54,   0,   50 ],
    [55,   154,  51,  100],
    [155,  254,  101, 150],
    [255,  354,  151, 200],
    [355,  424,  201, 300],
    [425,  504,  301, 400],
    [505,  604,  401, 500],
  ];
  return piecewiseLinear(c, bps);
}

/**
 * Sub-index computation for O3 (8-hour average, μg/m³).
 */
export function o3SubIndex(c: number): number {
  const bps: [number, number, number, number][] = [
    [0,   118,  0,   50 ],
    [119, 157,  51,  100],
    [158, 197,  101, 150],
    [198, 274,  151, 200],
    [275, 392,  201, 300],
    [393, 785,  301, 500],
  ];
  return piecewiseLinear(c, bps);
}

/**
 * Sub-index computation for NO2 (μg/m³).
 */
export function no2SubIndex(c: number): number {
  const bps: [number, number, number, number][] = [
    [0,   100,  0,   50 ],
    [101, 200,  51,  100],
    [201, 676,  101, 150],
    [677, 1220, 151, 200],
    [1221,2350, 201, 300],
    [2351,3100, 301, 400],
    [3101,3850, 401, 500],
  ];
  return piecewiseLinear(c, bps);
}

/**
 * Sub-index computation for SO2 (μg/m³).
 */
export function so2SubIndex(c: number): number {
  const bps: [number, number, number, number][] = [
    [0,   93,   0,   50 ],
    [94,  197,  51,  100],
    [198, 488,  101, 150],
    [489, 796,  151, 200],
    [797, 1583, 201, 300],
    [1584,2630, 301, 400],
    [2631,3500, 401, 500],
  ];
  return piecewiseLinear(c, bps);
}

/** Generic piecewise linear interpolation between AQI breakpoint pairs. */
function piecewiseLinear(
  c: number,
  bps: [number, number, number, number][],
): number {
  for (const [cLo, cHi, iLo, iHi] of bps) {
    if (c >= cLo && c <= cHi) {
      return Math.round(((iHi - iLo) / (cHi - cLo)) * (c - cLo) + iLo);
    }
  }
  // Beyond max breakpoint → cap at 500
  return 500;
}

/**
 * Compute composite AQI from pollutant concentrations.
 * Composite AQI = max of all sub-indices (US EPA method).
 *
 * Requirement 23.1: PM2.5, PM10, O3, NO2, SO2 from API.
 */
export function computeAQI(pollutants: AQIPollutants): {
  aqi: number;
  dominantPollutant: keyof AQIPollutants;
} {
  const subIndices: Record<keyof AQIPollutants, number> = {
    pm2_5: pm25SubIndex(pollutants.pm2_5),
    pm10:  pm10SubIndex(pollutants.pm10),
    o3:    o3SubIndex(pollutants.o3),
    no2:   no2SubIndex(pollutants.no2),
    so2:   so2SubIndex(pollutants.so2),
  };

  let maxAqi = 0;
  let dominant: keyof AQIPollutants = 'pm2_5';
  for (const [key, val] of Object.entries(subIndices) as [keyof AQIPollutants, number][]) {
    if (val > maxAqi) {
      maxAqi = val;
      dominant = key;
    }
  }
  return { aqi: maxAqi, dominantPollutant: dominant };
}

/**
 * Build AQIGridCell entries from raw API data.
 *
 * Requirement 23.2: color-coded grid overlay cells.
 */
export function buildAQIGridCells(
  rawData: Array<{ lat: number; lon: number; pollutants: AQIPollutants }>,
): AQIGridCell[] {
  return rawData.map(({ lat, lon, pollutants }) => {
    const { aqi, dominantPollutant } = computeAQI(pollutants);
    return {
      lat,
      lon,
      aqi,
      category: classifyAQI(aqi),
      color: aqiToColor(aqi),
      pollutants,
      dominantPollutant,
    };
  });
}

/**
 * Generate AQI alerts for all cells where AQI > 200.
 *
 * Requirement 23.3: alert when AQI > 200.
 */
export function generateAQIAlerts(cells: AQIGridCell[]): AQIAlert[] {
  return cells
    .filter((c) => c.aqi > AQI_ALERT_THRESHOLD)
    .map((c) => ({
      lat: c.lat,
      lon: c.lon,
      aqi: c.aqi,
      category: c.category,
      dominantPollutant: c.dominantPollutant,
      message: `AQI ${c.aqi} (${c.category}) at ${c.lat.toFixed(2)}°N, ${c.lon.toFixed(2)}°E — dominant: ${c.dominantPollutant.toUpperCase()}`,
    }))
    .sort((a, b) => b.aqi - a.aqi);
}

/**
 * Compute wind-AQI correlation data from AQI cells and wind grid cells.
 *
 * Maps each AQI cell to the nearest wind observation (by lat/lon).
 * Requirement 23.4: wind-AQI dispersion correlation.
 */
export function computeWindAQICorrelation(
  aqiCells: AQIGridCell[],
  windCells: Array<{ lat: number; lon: number; wind_speed: number; wind_direction: number }>,
): WindAQICorrelation[] {
  if (windCells.length === 0) return [];

  return aqiCells.map((cell) => {
    // Find nearest wind cell
    let nearest = windCells[0];
    let minDist = Infinity;
    for (const wc of windCells) {
      const d = Math.hypot(wc.lat - cell.lat, wc.lon - cell.lon);
      if (d < minDist) { minDist = d; nearest = wc; }
    }
    return {
      windSpeed: nearest.wind_speed,
      aqi: cell.aqi,
      windDirection: nearest.wind_direction,
      lat: cell.lat,
      lon: cell.lon,
    };
  });
}

// ── Open-Meteo API fetcher ────────────────────────────────────────────────────

/** Region bounding boxes for Open-Meteo grid sampling */
const REGION_BBOX: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  western_ghats:     { latMin: 8.0,  latMax: 21.0, lonMin: 74.0, lonMax: 78.0 },
  north_east_india:  { latMin: 22.0, latMax: 29.0, lonMin: 88.0, lonMax: 97.0 },
  indo_gangetic_plain: { latMin: 24.0, latMax: 30.0, lonMin: 75.0, lonMax: 88.0 },
  central_india:     { latMin: 18.0, latMax: 26.0, lonMin: 74.0, lonMax: 84.0 },
  pilot:             { latMin: 8.0,  latMax: 37.0, lonMin: 68.0, lonMax: 97.0 },
};

/** Spacing between sampled grid points (degrees) */
const SAMPLE_SPACING = 1.0; // 1° spacing to limit API calls

/** Generate a coarse grid of lat/lon points for a region */
function sampleGridPoints(region: RegionId): Array<{ lat: number; lon: number }> {
  const bbox = REGION_BBOX[region] ?? REGION_BBOX['pilot'];
  const points: Array<{ lat: number; lon: number }> = [];
  for (let lat = bbox.latMin; lat <= bbox.latMax; lat += SAMPLE_SPACING) {
    for (let lon = bbox.lonMin; lon <= bbox.lonMax; lon += SAMPLE_SPACING) {
      points.push({ lat: +lat.toFixed(2), lon: +lon.toFixed(2) });
    }
  }
  return points;
}

/**
 * Fetch AQI data from Open-Meteo Air Quality API for a single point.
 * Returns null on network error.
 */
async function fetchAQIPoint(
  lat: number,
  lon: number,
): Promise<{ lat: number; lon: number; pollutants: AQIPollutants } | null> {
  try {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide` +
      `&timezone=Asia%2FKolkata`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const cur = data?.current ?? {};
    return {
      lat,
      lon,
      pollutants: {
        pm2_5: cur.pm2_5   ?? 0,
        pm10:  cur.pm10    ?? 0,
        o3:    cur.ozone   ?? 0,
        no2:   cur.nitrogen_dioxide ?? 0,
        so2:   cur.sulphur_dioxide  ?? 0,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Fetch AQI for all sampled grid points in a region.
 * Fires requests in parallel; failed points are silently dropped.
 *
 * Requirement 23.1: fetch for all grid points in the active Region.
 */
export async function fetchRegionAQI(
  region: RegionId,
): Promise<Array<{ lat: number; lon: number; pollutants: AQIPollutants }>> {
  const points = sampleGridPoints(region);
  const results = await Promise.all(points.map(({ lat, lon }) => fetchAQIPoint(lat, lon)));
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

/** Mock AQI cells for demo / offline fallback */
export const MOCK_AQI_CELLS: AQIGridCell[] = [
  { lat: 28.5, lon: 77.2, aqi: 210, category: 'Very Unhealthy',  color: '#a855f7', pollutants: { pm2_5: 110, pm10: 180, o3: 90,  no2: 120, so2: 40 }, dominantPollutant: 'pm2_5' },
  { lat: 19.0, lon: 72.9, aqi: 145, category: 'Unhealthy for Sensitive Groups', color: '#f97316', pollutants: { pm2_5: 55,  pm10: 110, o3: 70,  no2: 80,  so2: 20 }, dominantPollutant: 'pm2_5' },
  { lat: 22.6, lon: 88.4, aqi: 165, category: 'Unhealthy',       color: '#ef4444', pollutants: { pm2_5: 70,  pm10: 140, o3: 65,  no2: 90,  so2: 30 }, dominantPollutant: 'pm10'  },
  { lat: 13.1, lon: 80.3, aqi: 90,  category: 'Moderate',        color: '#eab308', pollutants: { pm2_5: 30,  pm10: 60,  o3: 50,  no2: 45,  so2: 10 }, dominantPollutant: 'pm2_5' },
  { lat: 12.9, lon: 77.6, aqi: 45,  category: 'Good',            color: '#22c55e', pollutants: { pm2_5: 10,  pm10: 20,  o3: 30,  no2: 20,  so2: 5  }, dominantPollutant: 'o3'    },
  { lat: 17.4, lon: 78.5, aqi: 320, category: 'Hazardous',       color: '#7f1d1d', pollutants: { pm2_5: 200, pm10: 320, o3: 100, no2: 200, so2: 80 }, dominantPollutant: 'pm2_5' },
  { lat: 23.0, lon: 72.6, aqi: 110, category: 'Unhealthy for Sensitive Groups', color: '#f97316', pollutants: { pm2_5: 42,  pm10: 85,  o3: 60,  no2: 55,  so2: 15 }, dominantPollutant: 'pm2_5' },
  { lat: 26.9, lon: 75.8, aqi: 75,  category: 'Moderate',        color: '#eab308', pollutants: { pm2_5: 25,  pm10: 50,  o3: 40,  no2: 38,  so2: 8  }, dominantPollutant: 'pm2_5' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

/** AQI color scale legend */
const AQILegend: React.FC = () => (
  <div
    aria-label="AQI color scale legend"
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      marginBottom: '12px',
    }}
  >
    {AQI_BREAKPOINTS.map((bp) => (
      <div
        key={bp.category}
        title={`${bp.min}–${bp.max === 500 ? '500+' : bp.max}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '10px',
          color: 'rgba(255,255,255,0.7)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '3px',
            background: bp.color,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <span>{bp.category.replace('Unhealthy for Sensitive Groups', 'USG')}</span>
      </div>
    ))}
  </div>
);

/** Single AQI alert banner */
const AlertBanner: React.FC<{ alert: AQIAlert }> = ({ alert }) => {
  const bp = getAQIBreakpoint(alert.aqi);
  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        background: bp.bgColor,
        border: `1px solid ${bp.color}`,
        borderRadius: '8px',
        padding: '8px 12px',
        marginBottom: '6px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        animation: 'aqi-alert-pulse 2s ease-in-out infinite',
      }}
    >
      <span style={{ fontSize: '16px', flexShrink: 0 }} aria-hidden="true">⚠️</span>
      <div style={{ fontSize: '12px' }}>
        <span style={{ fontWeight: 700, color: bp.color }}>
          AQI {alert.aqi} — {alert.category}
        </span>
        <br />
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>{alert.message}</span>
      </div>
    </div>
  );
};

/** Pollutant breakdown row */
const PollutantRow: React.FC<{
  label: string;
  value: number;
  unit: string;
  subIndex: number;
  isDominant: boolean;
}> = ({ label, value, unit, subIndex, isDominant }) => {
  const bp = getAQIBreakpoint(subIndex);
  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <td style={{ padding: '4px 8px', color: 'rgba(255,255,255,0.65)', fontSize: '12px' }}>
        {isDominant && <span aria-label="dominant pollutant" title="Dominant pollutant">⬥ </span>}
        {label}
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '12px', color: 'rgba(255,255,255,0.85)' }}>
        {value.toFixed(1)} {unit}
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '12px' }}>
        <span style={{
          background: bp.bgColor,
          border: `1px solid ${bp.color}`,
          borderRadius: '4px',
          color: bp.color,
          fontWeight: 600,
          padding: '1px 6px',
        }}>
          {subIndex}
        </span>
      </td>
    </tr>
  );
};

/** AQI cell detail panel shown when a cell is selected */
const AQICellDetail: React.FC<{ cell: AQIGridCell }> = ({ cell }) => {
  const p = cell.pollutants;
  const bp = getAQIBreakpoint(cell.aqi);
  const rows = [
    { label: 'PM2.5', value: p.pm2_5, unit: 'μg/m³', subIndex: pm25SubIndex(p.pm2_5), key: 'pm2_5' as const },
    { label: 'PM10',  value: p.pm10,  unit: 'μg/m³', subIndex: pm10SubIndex(p.pm10),  key: 'pm10'  as const },
    { label: 'O₃',    value: p.o3,    unit: 'μg/m³', subIndex: o3SubIndex(p.o3),      key: 'o3'    as const },
    { label: 'NO₂',   value: p.no2,   unit: 'μg/m³', subIndex: no2SubIndex(p.no2),    key: 'no2'   as const },
    { label: 'SO₂',   value: p.so2,   unit: 'μg/m³', subIndex: so2SubIndex(p.so2),    key: 'so2'   as const },
  ];

  return (
    <div style={{
      background: bp.bgColor,
      border: `1px solid ${bp.color}50`,
      borderRadius: '8px',
      padding: '12px',
      marginTop: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div>
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)' }}>
            {cell.lat.toFixed(2)}°N, {cell.lon.toFixed(2)}°E
          </span>
        </div>
        <span style={{ fontSize: '22px', fontWeight: 700, color: bp.color }}>{cell.aqi}</span>
      </div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: bp.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
        {cell.category}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
             aria-label="Pollutant breakdown">
        <thead>
          <tr>
            {['Pollutant', 'Conc.', 'Sub-AQI'].map((h) => (
              <th key={h} scope="col" style={{
                padding: '4px 8px',
                textAlign: h === 'Pollutant' ? 'left' : 'right',
                fontSize: '11px', color: 'rgba(255,255,255,0.4)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PollutantRow
              key={r.key}
              label={r.label}
              value={r.value}
              unit={r.unit}
              subIndex={r.subIndex}
              isDominant={cell.dominantPollutant === r.key}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Wind-AQI scatter correlation mini-chart (canvas-based sparkline) */
const WindAQICorrelationPanel: React.FC<{ data: WindAQICorrelation[] }> = ({ data }) => {
  if (data.length === 0) return null;

  // Simple text summary — correlation coefficient
  const n = data.length;
  const meanWind = data.reduce((s, d) => s + d.windSpeed, 0) / n;
  const meanAQI  = data.reduce((s, d) => s + d.aqi, 0) / n;
  const cov = data.reduce((s, d) => s + (d.windSpeed - meanWind) * (d.aqi - meanAQI), 0) / n;
  const stdWind = Math.sqrt(data.reduce((s, d) => s + (d.windSpeed - meanWind) ** 2, 0) / n);
  const stdAQI  = Math.sqrt(data.reduce((s, d) => s + (d.aqi - meanAQI) ** 2, 0) / n);
  const r = (stdWind > 0 && stdAQI > 0) ? cov / (stdWind * stdAQI) : 0;

  const interpretation =
    r < -0.5 ? 'Strong negative: high wind disperses pollutants' :
    r < -0.2 ? 'Moderate negative: wind partially disperses AQI' :
    r <  0.2 ? 'Weak: wind speed not correlated with AQI here' :
    r <  0.5 ? 'Moderate positive: wind transporting pollutants' :
               'Strong positive: wind carrying pollution';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '8px',
      padding: '12px',
      marginTop: '12px',
    }}>
      <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.8)', margin: '0 0 8px 0' }}>
        🌬️ Wind–AQI Dispersion Correlation
      </h4>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12px' }}>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>Pearson r: </span>
          <span style={{
            fontWeight: 700,
            color: r < -0.3 ? '#22c55e' : r > 0.3 ? '#ef4444' : '#94a3b8',
          }}>
            {r.toFixed(2)}
          </span>
        </div>
        <div style={{ fontSize: '12px' }}>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>Avg Wind: </span>
          <span style={{ color: 'rgba(255,255,255,0.85)' }}>{meanWind.toFixed(1)} m/s</span>
        </div>
        <div style={{ fontSize: '12px' }}>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>Avg AQI: </span>
          <span style={{ color: aqiToColor(meanAQI), fontWeight: 600 }}>{Math.round(meanAQI)}</span>
        </div>
      </div>
      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: '6px 0 0 0', fontStyle: 'italic' }}>
        {interpretation}
      </p>

      {/* Scatter dots — compact visual */}
      <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', marginTop: '8px', height: '40px' }}>
        {data.slice(0, 20).map((d, i) => {
          const h = Math.max(4, Math.min(40, (d.aqi / 500) * 40));
          return (
            <div
              key={i}
              title={`Wind ${d.windSpeed.toFixed(1)} m/s → AQI ${d.aqi}`}
              style={{
                flex: 1,
                height: `${h}px`,
                background: aqiToColor(d.aqi),
                borderRadius: '2px',
                opacity: 0.8,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
        <span>Lowest wind →</span>
        <span>← Highest wind</span>
      </div>
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AQIPanelProps {
  /** Active region for fetching AQI data */
  region?: RegionId;
  /** Whether the panel is active */
  enabled?: boolean;
  /** Pre-fetched grid cells with wind data for correlation */
  windCells?: Array<{ lat: number; lon: number; wind_speed: number; wind_direction: number }>;
  /** Called when a grid cell is selected; consumers can render the overlay */
  onCellSelect?: (cell: AQIGridCell) => void;
  /** Called when alerts are generated; consumers can show global notifications */
  onAlerts?: (alerts: AQIAlert[]) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * AQIPanel — Air Quality Index Integration Panel.
 *
 * Validates: Requirements 23.1, 23.2, 23.3, 23.4
 */
export const AQIPanel: React.FC<AQIPanelProps> = ({
  region = 'pilot',
  enabled = true,
  windCells = [],
  onCellSelect,
  onAlerts,
}) => {
  const [aqiCells, setAqiCells]       = useState<AQIGridCell[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<AQIGridCell | null>(null);
  const [useMock, setUseMock]         = useState(false);

  // Fetch AQI data from Open-Meteo on mount / region change
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchRegionAQI(region)
      .then((raw) => {
        if (cancelled) return;
        if (raw.length === 0) {
          // Fallback to mock data
          setAqiCells(MOCK_AQI_CELLS);
          setUseMock(true);
        } else {
          setAqiCells(buildAQIGridCells(raw));
          setUseMock(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAqiCells(MOCK_AQI_CELLS);
        setUseMock(true);
        setError('Unable to reach Air Quality API — showing demo data');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [region, enabled]);

  // Generate alerts whenever cells change; notify parent
  const alerts = useMemo(() => generateAQIAlerts(aqiCells), [aqiCells]);
  useEffect(() => {
    if (alerts.length > 0) onAlerts?.(alerts);
  }, [alerts, onAlerts]);

  // Wind-AQI correlation
  const correlationData = useMemo(
    () => computeWindAQICorrelation(aqiCells, windCells),
    [aqiCells, windCells],
  );

  // AQI summary stats
  const stats = useMemo(() => {
    if (aqiCells.length === 0) return null;
    const aqiValues = aqiCells.map((c) => c.aqi);
    const maxAQI = Math.max(...aqiValues);
    const avgAQI = Math.round(aqiValues.reduce((s, v) => s + v, 0) / aqiValues.length);
    const unhealthyCount = aqiCells.filter((c) => c.aqi > 100).length;
    return { maxAQI, avgAQI, unhealthyCount, total: aqiCells.length };
  }, [aqiCells]);

  const handleCellSelect = (cell: AQIGridCell) => {
    const next = selectedCell?.lat === cell.lat && selectedCell?.lon === cell.lon ? null : cell;
    setSelectedCell(next);
    if (next) onCellSelect?.(next);
  };

  if (!enabled) return null;

  return (
    <div
      className="aqi-panel"
      data-testid="aqi-panel"
      role="region"
      aria-label="Air Quality Index Panel"
    >
      {/* ── Alerts ── */}
      {alerts.length > 0 && (
        <div aria-label={`${alerts.length} AQI alert${alerts.length > 1 ? 's' : ''}`}>
          {alerts.slice(0, 3).map((alert, i) => (
            <AlertBanner key={`${alert.lat}-${alert.lon}-${i}`} alert={alert} />
          ))}
          {alerts.length > 3 && (
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px', textAlign: 'center' }}>
              +{alerts.length - 3} more alerts
            </div>
          )}
        </div>
      )}

      {/* ── Main Glass Panel ── */}
      <GlassPanel padding="md" className="aqi-panel__main">
        {/* Header */}
        <h3 style={{
          fontSize: '18px', fontWeight: 600, color: 'rgba(255,255,255,0.95)',
          margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          🌫️ Air Quality Index
          {useMock && (
            <span style={{ fontSize: '10px', color: '#eab308', fontWeight: 400,
              border: '1px solid #eab308', borderRadius: '4px', padding: '1px 6px' }}>
              DEMO
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>
            {loading ? 'Loading…' : `${aqiCells.length} points`}
          </span>
        </h3>

        {/* Error notice */}
        {error && (
          <div style={{ fontSize: '11px', color: '#eab308', marginBottom: '8px', background: 'rgba(234,179,8,0.1)',
            border: '1px solid rgba(234,179,8,0.3)', borderRadius: '6px', padding: '6px 10px' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Summary stats */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
            {[
              { label: 'Max AQI',     value: stats.maxAQI,        color: aqiToColor(stats.maxAQI) },
              { label: 'Avg AQI',     value: stats.avgAQI,        color: aqiToColor(stats.avgAQI) },
              { label: 'Unhealthy',   value: `${stats.unhealthyCount}/${stats.total}`, color: '#ef4444' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: 'rgba(255,255,255,0.04)', borderRadius: '6px',
                padding: '8px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Color legend */}
        <AQILegend />

        {/* Grid cell list */}
        {!loading && aqiCells.length > 0 && (
          <div style={{ overflowY: 'auto', maxHeight: '280px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
                   aria-label="AQI grid cells">
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
                <tr>
                  {['Location', 'AQI', 'Category', 'Dominant'].map((h, i) => (
                    <th key={h} scope="col" style={{
                      padding: '6px 8px',
                      textAlign: i === 0 ? 'left' : 'center',
                      fontSize: '11px', fontWeight: 600,
                      color: 'rgba(255,255,255,0.5)',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aqiCells
                  .slice()
                  .sort((a, b) => b.aqi - a.aqi)
                  .map((cell, idx) => {
                    const bp = getAQIBreakpoint(cell.aqi);
                    const isSelected = selectedCell?.lat === cell.lat && selectedCell?.lon === cell.lon;
                    return (
                      <tr
                        key={`${cell.lat}-${cell.lon}`}
                        onClick={() => handleCellSelect(cell)}
                        aria-selected={isSelected}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(255,255,255,0.08)' : idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                          borderLeft: isSelected ? `3px solid ${bp.color}` : '3px solid transparent',
                          transition: 'background 150ms ease',
                        }}
                      >
                        <td style={{ padding: '4px 8px', color: 'rgba(255,255,255,0.65)' }}>
                          {cell.lat.toFixed(1)}°N {cell.lon.toFixed(1)}°E
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <span style={{
                            background: bp.bgColor, border: `1px solid ${bp.color}`,
                            borderRadius: '4px', color: bp.color, fontWeight: 700,
                            padding: '1px 6px', fontSize: '11px',
                          }}>
                            {cell.aqi}
                          </span>
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: '11px', color: bp.color }}>
                          {cell.category === 'Unhealthy for Sensitive Groups' ? 'USG' : cell.category}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: '11px',
                          color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>
                          {cell.dominantPollutant.replace('_', '')}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}

        {/* Selected cell detail */}
        {selectedCell && <AQICellDetail cell={selectedCell} />}

        {/* Wind-AQI correlation (Req 23.4) */}
        <WindAQICorrelationPanel data={correlationData} />
      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes aqi-alert-pulse {
          0%, 100% { box-shadow: 0 0 5px rgba(168,85,247,0.25); }
          50%       { box-shadow: 0 0 16px rgba(168,85,247,0.6); }
        }
      `}</style>
    </div>
  );
};

export default AQIPanel;
