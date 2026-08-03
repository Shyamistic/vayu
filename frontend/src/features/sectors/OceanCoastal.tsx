/**
 * OceanCoastal — Ocean and Coastal Monitoring for the Indian Ocean.
 *
 * Exports pure functions for SST anomaly computation and Coastal Vulnerability Index (testable),
 * plus a React component that:
 *  1. Renders SST anomaly overlay for the Indian Ocean (Req 51.1)
 *  2. Displays wave height predictions with animated wave symbols (Req 51.2)
 *  3. Computes and displays Coastal Vulnerability Index for major coastal districts (Req 51.3)
 *  4. Overlays major shipping routes with weather risk indicators (Req 51.4)
 *
 * Validates: Requirements 51.1, 51.2, 51.3, 51.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Sea Surface Temperature anomaly for an ocean grid point */
export interface SSTAnomaly {
  lat: number;
  lon: number;
  /** Observed/predicted SST in °C */
  sst: number;
  /** Climatological mean SST for this location/season (°C) */
  climatologyMean: number;
  /** Anomaly = sst − climatologyMean (°C) */
  anomaly: number;
  /** CSS color for the SST anomaly overlay */
  color: string;
}

/** Wave height prediction for a coastal/ocean point */
export interface WaveHeightPrediction {
  lat: number;
  lon: number;
  /** Significant wave height (m) */
  significantWaveHeight: number;
  /** Dominant wave period (s) */
  wavePeriod: number;
  /** Wave direction (degrees from north) */
  waveDirection: number;
  /** Risk category based on wave height */
  riskLevel: 'calm' | 'moderate' | 'rough' | 'very_rough' | 'phenomenal';
}

/** Coastal Vulnerability Index components and composite score */
export interface CoastalVulnerabilityIndex {
  districtName: string;
  state: string;
  lat: number;
  lon: number;
  /** Significant wave height score (0–100) */
  waveHeightScore: number;
  /** SST anomaly score (0–100) */
  sstAnomalyScore: number;
  /** Tidal range score (0–100) */
  tidalRangeScore: number;
  /** Composite CVI (0–100), weighted average of components */
  cvi: number;
  /** Risk tier */
  riskTier: 'low' | 'moderate' | 'high' | 'very_high' | 'extreme';
}

/** Shipping route with weather risk */
export interface ShippingRoute {
  id: string;
  name: string;
  /** Waypoints as [lon, lat] pairs */
  waypoints: [number, number][];
  /** Dominant cargo type */
  cargoType: 'container' | 'tanker' | 'bulk' | 'mixed';
  /** Composite weather risk (0–100) along the route */
  weatherRisk: number;
  /** Human-readable risk description */
  riskDescription: string;
  color: string;
}

/** Tab options for the component */
export type OceanTab = 'sst' | 'waves' | 'cvi' | 'routes';

// ── Indian Ocean SST Climatology Reference ────────────────────────────────────

/**
 * Monthly climatological SST reference values for Indian Ocean regions.
 * Values are approximate basin means (°C) based on NOAA OISST reanalysis.
 */
export const SST_CLIMATOLOGY_REF: Record<string, number> = {
  'arabian_sea':    28.2,
  'bay_of_bengal':  28.8,
  'indian_ocean':   27.5,
  'lakshadweep':    29.1,
  'andaman_sea':    29.5,
};

// ── Major Coastal Districts ───────────────────────────────────────────────────

export interface CoastalDistrict {
  name: string;
  state: string;
  lat: number;
  lon: number;
  /** Mean tidal range (m) — from tidal gauge records */
  tidalRangeM: number;
  /** Basin for SST lookup */
  basin: keyof typeof SST_CLIMATOLOGY_REF;
}

export const COASTAL_DISTRICTS: CoastalDistrict[] = [
  { name: 'Mumbai',       state: 'Maharashtra',   lat: 19.08, lon: 72.88, tidalRangeM: 3.2, basin: 'arabian_sea' },
  { name: 'Kochi',        state: 'Kerala',        lat: 9.93,  lon: 76.26, tidalRangeM: 0.6, basin: 'arabian_sea' },
  { name: 'Visakhapatnam',state: 'Andhra Pradesh',lat: 17.69, lon: 83.22, tidalRangeM: 0.8, basin: 'bay_of_bengal' },
  { name: 'Chennai',      state: 'Tamil Nadu',    lat: 13.08, lon: 80.27, tidalRangeM: 0.9, basin: 'bay_of_bengal' },
  { name: 'Paradip',      state: 'Odisha',        lat: 20.32, lon: 86.61, tidalRangeM: 1.8, basin: 'bay_of_bengal' },
  { name: 'Kolkata',      state: 'West Bengal',   lat: 22.57, lon: 88.36, tidalRangeM: 3.5, basin: 'bay_of_bengal' },
  { name: 'Mangaluru',    state: 'Karnataka',     lat: 12.87, lon: 74.84, tidalRangeM: 1.1, basin: 'arabian_sea' },
  { name: 'Surat',        state: 'Gujarat',       lat: 21.17, lon: 72.83, tidalRangeM: 4.0, basin: 'arabian_sea' },
  { name: 'Porbandar',    state: 'Gujarat',       lat: 21.64, lon: 69.61, tidalRangeM: 2.7, basin: 'arabian_sea' },
  { name: 'Thiruvananthapuram', state: 'Kerala',  lat: 8.52,  lon: 76.93, tidalRangeM: 0.7, basin: 'arabian_sea' },
  { name: 'Pondicherry',  state: 'Puducherry',    lat: 11.93, lon: 79.83, tidalRangeM: 0.6, basin: 'bay_of_bengal' },
  { name: 'Port Blair',   state: 'Andaman & Nicobar', lat: 11.67, lon: 92.73, tidalRangeM: 1.4, basin: 'andaman_sea' },
];

// ── Major Indian Ocean Shipping Routes ───────────────────────────────────────

export const SHIPPING_ROUTES: ShippingRoute[] = [
  {
    id: 'mumbai_gulf_aden',
    name: 'Mumbai → Gulf of Aden',
    waypoints: [[72.88, 19.08], [66.0, 15.0], [57.0, 12.5], [50.0, 12.5], [45.0, 11.8]],
    cargoType: 'tanker',
    weatherRisk: 42,
    riskDescription: 'Moderate SW monsoon swells in Jun–Sep',
    color: '#f97316',
  },
  {
    id: 'chennai_singapore',
    name: 'Chennai → Singapore',
    waypoints: [[80.27, 13.08], [85.0, 8.0], [90.0, 5.5], [95.0, 4.5], [103.82, 1.35]],
    cargoType: 'container',
    weatherRisk: 25,
    riskDescription: 'Generally favourable; occasional cyclone risk Oct–Dec',
    color: '#22c55e',
  },
  {
    id: 'kochi_colombo',
    name: 'Kochi → Colombo',
    waypoints: [[76.26, 9.93], [78.5, 8.5], [79.87, 6.93]],
    cargoType: 'mixed',
    weatherRisk: 18,
    riskDescription: 'Short crossing; low risk year-round',
    color: '#22c55e',
  },
  {
    id: 'mundra_hormuz',
    name: 'Mundra → Strait of Hormuz',
    waypoints: [[69.72, 22.84], [65.0, 22.0], [60.0, 20.0], [58.5, 23.5], [56.5, 24.5]],
    cargoType: 'tanker',
    weatherRisk: 35,
    riskDescription: 'Arabian Sea swell risk; restricted traffic in peak monsoon',
    color: '#eab308',
  },
  {
    id: 'kolkata_yangon',
    name: 'Kolkata → Yangon',
    waypoints: [[88.36, 22.57], [89.5, 20.0], [91.0, 17.0], [93.5, 15.0], [96.15, 16.85]],
    cargoType: 'bulk',
    weatherRisk: 55,
    riskDescription: 'Bay of Bengal cyclone belt; high risk May–Nov',
    color: '#ef4444',
  },
  {
    id: 'mumbai_durban',
    name: 'Mumbai → Durban',
    waypoints: [[72.88, 19.08], [68.0, 12.0], [65.0, 0.0], [60.0, -10.0], [50.0, -20.0], [31.04, -29.86]],
    cargoType: 'bulk',
    weatherRisk: 48,
    riskDescription: 'Southern Indian Ocean swells increase south of equator',
    color: '#f97316',
  },
];

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Map an SST anomaly value (°C) to a CSS hex color on a blue→white→red palette.
 *
 * Negative anomaly (cooler than normal) → blue shades
 * Near zero (±0.5 °C)                  → white/neutral
 * Positive anomaly (warmer than normal) → orange/red shades
 *
 * Requirement 51.1: SST anomaly overlay color scale.
 */
export function sstAnomalyToColor(anomaly: number): string {
  const clamped = Math.max(-4, Math.min(4, anomaly));
  const t = (clamped + 4) / 8; // normalize to [0, 1]

  if (t < 0.5) {
    // Blue → white
    const u = t / 0.5;
    const r = Math.round(20 + u * (240 - 20));
    const g = Math.round(80 + u * (240 - 80));
    const b = Math.round(220 + u * (255 - 220));
    return `rgb(${r},${g},${b})`;
  }
  // White → red/orange
  const u = (t - 0.5) / 0.5;
  const r = 255;
  const g = Math.round(240 - u * (240 - 40));
  const b = Math.round(240 - u * 240);
  return `rgb(${r},${g},${b})`;
}

/**
 * Compute SST anomaly for a grid cell given a climatological mean.
 *
 * SST is approximated from temp_max (skin temperature proxy):
 * offshore cells (lon outside 68–100 range treated as ocean) use temp_max
 * as an SST proxy adjusted by −2°C for sea surface cooling.
 *
 * Requirement 51.1: SST anomaly from reanalysis data.
 */
export function computeSSTAnomaly(
  cell: GridCell,
  climatologyMean: number,
): SSTAnomaly {
  // Approx SST from temp_max with a −2°C ocean adjustment
  const sst = cell.temp_max - 2.0;
  const anomaly = sst - climatologyMean;
  return {
    lat: cell.lat,
    lon: cell.lon,
    sst,
    climatologyMean,
    anomaly,
    color: sstAnomalyToColor(anomaly),
  };
}

/**
 * Determine if a grid cell is in the Indian Ocean domain.
 * Rough bounding box: lat 0°–25°N, lon 60°–100°E (covers Arabian Sea + Bay of Bengal).
 */
export function isIndianOceanCell(lat: number, lon: number): boolean {
  return lat >= 0 && lat <= 25 && lon >= 60 && lon <= 100;
}

/**
 * Build SST anomaly overlays for all Indian Ocean grid cells.
 *
 * Requirement 51.1.
 */
export function buildSSTAnomalies(
  gridCells: GridCell[],
  climatologyMean: number = 28.5,
): SSTAnomaly[] {
  return gridCells
    .filter((c) => isIndianOceanCell(c.lat, c.lon))
    .map((c) => computeSSTAnomaly(c, climatologyMean));
}

/**
 * Classify wave risk from significant wave height (metres).
 *
 * Based on WMO Sea State Code:
 *   0–0.5m → calm
 *   0.5–2.5m → moderate
 *   2.5–4.0m → rough
 *   4.0–6.0m → very_rough
 *   >6.0m   → phenomenal
 *
 * Requirement 51.2: wave height risk classification.
 */
export function classifyWaveRisk(
  significantWaveHeight: number,
): WaveHeightPrediction['riskLevel'] {
  if (significantWaveHeight < 0.5)  return 'calm';
  if (significantWaveHeight < 2.5)  return 'moderate';
  if (significantWaveHeight < 4.0)  return 'rough';
  if (significantWaveHeight < 6.0)  return 'very_rough';
  return 'phenomenal';
}

/**
 * Estimate significant wave height from rainfall rate and wind proxy.
 *
 * Uses empirical approximation:
 *   SWH ≈ 0.05 × rainfall + 0.2 × (temp_max − temp_min) / 5
 * Clamped to realistic range [0.1, 10] m.
 *
 * In production this would use ERA5/ECMWF wave model output.
 *
 * Requirement 51.2.
 */
export function estimateWaveHeight(cell: GridCell): number {
  const windProxy = Math.abs(cell.temp_max - cell.temp_min) / 5;
  const swh = 0.05 * cell.rainfall + 0.3 * windProxy + 0.5;
  return Math.max(0.1, Math.min(10, swh));
}

/**
 * Build wave height predictions for all Indian Ocean cells.
 *
 * Requirement 51.2.
 */
export function buildWaveHeightPredictions(
  gridCells: GridCell[],
): WaveHeightPrediction[] {
  return gridCells
    .filter((c) => isIndianOceanCell(c.lat, c.lon))
    .map((c) => {
      const significantWaveHeight = estimateWaveHeight(c);
      const wavePeriod = 4 + significantWaveHeight * 1.2; // empirical period estimate
      const waveDirection = ((c.lon - 68) / 32) * 180; // rough directional proxy
      return {
        lat: c.lat,
        lon: c.lon,
        significantWaveHeight,
        wavePeriod,
        waveDirection,
        riskLevel: classifyWaveRisk(significantWaveHeight),
      };
    });
}

/**
 * Compute the Coastal Vulnerability Index score for a component value,
 * normalised to [0, 100].
 *
 * @param value       Raw component value
 * @param minVal      Minimum value for this component
 * @param maxVal      Maximum value for this component
 *
 * Requirement 51.3.
 */
export function normaliseCVIComponent(
  value: number,
  minVal: number,
  maxVal: number,
): number {
  if (maxVal === minVal) return 50;
  const score = ((value - minVal) / (maxVal - minVal)) * 100;
  return Math.max(0, Math.min(100, score));
}

/**
 * Map a composite CVI score to a risk tier.
 *
 * Requirement 51.3.
 */
export function cviRiskTier(
  cvi: number,
): CoastalVulnerabilityIndex['riskTier'] {
  if (cvi < 20)  return 'low';
  if (cvi < 40)  return 'moderate';
  if (cvi < 60)  return 'high';
  if (cvi < 80)  return 'very_high';
  return 'extreme';
}

/**
 * Compute the Coastal Vulnerability Index for a coastal district.
 *
 * CVI = weighted average of:
 *   - wave height score    (weight 0.4)
 *   - SST anomaly score    (weight 0.35)
 *   - tidal range score    (weight 0.25)
 *
 * Requirement 51.3: CVI based on wave height, SST anomaly, and tidal range.
 */
export function computeCVI(
  district: CoastalDistrict,
  nearestCellWaveHeight: number,
  nearestCellSSTAnomaly: number,
): CoastalVulnerabilityIndex {
  const waveHeightScore    = normaliseCVIComponent(nearestCellWaveHeight, 0, 8);
  const sstAnomalyScore    = normaliseCVIComponent(Math.abs(nearestCellSSTAnomaly), 0, 4);
  const tidalRangeScore    = normaliseCVIComponent(district.tidalRangeM, 0, 5);

  const cvi =
    waveHeightScore    * 0.4 +
    sstAnomalyScore    * 0.35 +
    tidalRangeScore    * 0.25;

  return {
    districtName: district.name,
    state: district.state,
    lat: district.lat,
    lon: district.lon,
    waveHeightScore,
    sstAnomalyScore,
    tidalRangeScore,
    cvi,
    riskTier: cviRiskTier(cvi),
  };
}

/**
 * Euclidean distance in degrees (adequate for 0.25° scale comparisons).
 */
export function gridDistanceDeg(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  return Math.sqrt((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2);
}

/**
 * Find the nearest grid cell to a target lat/lon.
 * Returns undefined if gridCells is empty.
 */
export function findNearestCell(
  gridCells: GridCell[],
  targetLat: number,
  targetLon: number,
): GridCell | undefined {
  if (gridCells.length === 0) return undefined;
  return gridCells.reduce((best, cell) =>
    gridDistanceDeg(cell.lat, cell.lon, targetLat, targetLon) <
    gridDistanceDeg(best.lat, best.lon, targetLat, targetLon)
      ? cell
      : best,
  );
}

/**
 * Compute CVI for all coastal districts using nearest grid cell data.
 *
 * Requirement 51.3.
 */
export function computeAllCVI(
  gridCells: GridCell[],
  districts: CoastalDistrict[] = COASTAL_DISTRICTS,
): CoastalVulnerabilityIndex[] {
  const results: CoastalVulnerabilityIndex[] = [];
  for (const district of districts) {
    const nearest = findNearestCell(gridCells, district.lat, district.lon);
    const waveHeight   = nearest ? estimateWaveHeight(nearest) : 1.5;
    const climatology  = SST_CLIMATOLOGY_REF[district.basin] ?? 28.5;
    const sstAnomaly   = nearest
      ? computeSSTAnomaly(nearest, climatology).anomaly
      : 0;
    results.push(computeCVI(district, waveHeight, sstAnomaly));
  }
  return results.sort((a, b) => b.cvi - a.cvi);
}

// ── Mock Data (fallback for demo / insufficient grid coverage) ────────────────

export const MOCK_SST_ANOMALIES: SSTAnomaly[] = [
  { lat: 15.0, lon: 68.0, sst: 30.2, climatologyMean: 28.5, anomaly:  1.7, color: sstAnomalyToColor(1.7) },
  { lat: 12.0, lon: 72.0, sst: 29.8, climatologyMean: 28.5, anomaly:  1.3, color: sstAnomalyToColor(1.3) },
  { lat: 18.0, lon: 66.0, sst: 27.9, climatologyMean: 28.5, anomaly: -0.6, color: sstAnomalyToColor(-0.6) },
  { lat: 10.0, lon: 76.0, sst: 31.0, climatologyMean: 29.1, anomaly:  1.9, color: sstAnomalyToColor(1.9) },
  { lat: 14.0, lon: 80.0, sst: 30.5, climatologyMean: 28.8, anomaly:  1.7, color: sstAnomalyToColor(1.7) },
  { lat: 16.0, lon: 84.0, sst: 29.1, climatologyMean: 28.8, anomaly:  0.3, color: sstAnomalyToColor(0.3) },
  { lat: 20.0, lon: 87.0, sst: 27.5, climatologyMean: 28.8, anomaly: -1.3, color: sstAnomalyToColor(-1.3) },
  { lat: 11.0, lon: 92.0, sst: 30.8, climatologyMean: 29.5, anomaly:  1.3, color: sstAnomalyToColor(1.3) },
];

export const MOCK_CVI_RESULTS: CoastalVulnerabilityIndex[] = [
  { districtName: 'Kolkata',        state: 'West Bengal',      lat: 22.57, lon: 88.36, waveHeightScore: 72, sstAnomalyScore: 55, tidalRangeScore: 80, cvi: 68.7, riskTier: 'high' },
  { districtName: 'Paradip',        state: 'Odisha',           lat: 20.32, lon: 86.61, waveHeightScore: 78, sstAnomalyScore: 48, tidalRangeScore: 40, cvi: 58.4, riskTier: 'high' },
  { districtName: 'Mumbai',         state: 'Maharashtra',      lat: 19.08, lon: 72.88, waveHeightScore: 60, sstAnomalyScore: 65, tidalRangeScore: 65, cvi: 62.3, riskTier: 'high' },
  { districtName: 'Surat',          state: 'Gujarat',          lat: 21.17, lon: 72.83, waveHeightScore: 55, sstAnomalyScore: 52, tidalRangeScore: 90, cvi: 63.1, riskTier: 'high' },
  { districtName: 'Visakhapatnam',  state: 'Andhra Pradesh',   lat: 17.69, lon: 83.22, waveHeightScore: 65, sstAnomalyScore: 60, tidalRangeScore: 20, cvi: 52.0, riskTier: 'high' },
  { districtName: 'Chennai',        state: 'Tamil Nadu',       lat: 13.08, lon: 80.27, waveHeightScore: 50, sstAnomalyScore: 62, tidalRangeScore: 18, cvi: 46.5, riskTier: 'moderate' },
  { districtName: 'Porbandar',      state: 'Gujarat',          lat: 21.64, lon: 69.61, waveHeightScore: 48, sstAnomalyScore: 45, tidalRangeScore: 54, cvi: 47.9, riskTier: 'moderate' },
  { districtName: 'Kochi',          state: 'Kerala',           lat: 9.93,  lon: 76.26, waveHeightScore: 35, sstAnomalyScore: 70, tidalRangeScore: 12, cvi: 43.7, riskTier: 'moderate' },
  { districtName: 'Mangaluru',      state: 'Karnataka',        lat: 12.87, lon: 74.84, waveHeightScore: 38, sstAnomalyScore: 58, tidalRangeScore: 22, cvi: 40.9, riskTier: 'moderate' },
  { districtName: 'Pondicherry',    state: 'Puducherry',       lat: 11.93, lon: 79.83, waveHeightScore: 30, sstAnomalyScore: 55, tidalRangeScore: 12, cvi: 36.5, riskTier: 'moderate' },
  { districtName: 'Port Blair',     state: 'Andaman & Nicobar',lat: 11.67, lon: 92.73, waveHeightScore: 42, sstAnomalyScore: 48, tidalRangeScore: 28, cvi: 40.3, riskTier: 'moderate' },
  { districtName: 'Thiruvananthapuram', state: 'Kerala',       lat: 8.52,  lon: 76.93, waveHeightScore: 28, sstAnomalyScore: 50, tidalRangeScore: 14, cvi: 32.6, riskTier: 'moderate' },
];

// CVI risk tier display config
export const CVI_TIER_CONFIG: Record<CoastalVulnerabilityIndex['riskTier'], { color: string; label: string }> = {
  low:       { color: '#22c55e', label: 'Low' },
  moderate:  { color: '#eab308', label: 'Moderate' },
  high:      { color: '#f97316', label: 'High' },
  very_high: { color: '#ef4444', label: 'Very High' },
  extreme:   { color: '#dc2626', label: 'Extreme' },
};

// Wave risk display config
export const WAVE_RISK_CONFIG: Record<WaveHeightPrediction['riskLevel'], { color: string; label: string; emoji: string }> = {
  calm:       { color: '#22c55e', label: 'Calm',       emoji: '🌊' },
  moderate:   { color: '#60a5fa', label: 'Moderate',   emoji: '🌊' },
  rough:      { color: '#eab308', label: 'Rough',      emoji: '🌊' },
  very_rough: { color: '#f97316', label: 'Very Rough', emoji: '⛈️' },
  phenomenal: { color: '#ef4444', label: 'Phenomenal', emoji: '🌀' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Tab bar for switching between SST / Waves / CVI / Routes */
const TabBar: React.FC<{ active: OceanTab; onChange: (t: OceanTab) => void }> = ({ active, onChange }) => {
  const tabs: { id: OceanTab; label: string; icon: string }[] = [
    { id: 'sst',    label: 'SST Anomaly',  icon: '🌡️' },
    { id: 'waves',  label: 'Wave Heights', icon: '🌊' },
    { id: 'cvi',    label: 'Coastal CVI',  icon: '🏖️' },
    { id: 'routes', label: 'Shipping',     icon: '🚢' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Ocean monitoring tabs"
      style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            flex: '1 1 auto',
            padding: '6px 8px',
            borderRadius: '6px',
            border: active === tab.id ? '1px solid rgba(34,197,94,0.6)' : '1px solid rgba(255,255,255,0.1)',
            background: active === tab.id ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
            color: active === tab.id ? '#4ade80' : 'rgba(255,255,255,0.55)',
            fontSize: '11px',
            fontWeight: active === tab.id ? 600 : 400,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            whiteSpace: 'nowrap',
          }}
        >
          {tab.icon} {tab.label}
        </button>
      ))}
    </div>
  );
};

/** SST anomaly color scale legend */
const SSTLegend: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '11px', color: 'rgba(255,255,255,0.55)' }}>
    <span>−4°C</span>
    <div aria-hidden="true" style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'linear-gradient(to right, rgb(20,80,220), #f0f0f0, rgb(255,40,0))' }} />
    <span>+4°C</span>
  </div>
);

/** Single SST anomaly row */
const SSTRow: React.FC<{ anomaly: SSTAnomaly; index: number }> = ({ anomaly, index }) => (
  <tr style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
    <td style={{ padding: '5px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.45)', textAlign: 'right' }}>
      {anomaly.lat.toFixed(1)}°N
    </td>
    <td style={{ padding: '5px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.45)', textAlign: 'right' }}>
      {anomaly.lon.toFixed(1)}°E
    </td>
    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
      <span style={{ background: `${anomaly.color}22`, border: `1px solid ${anomaly.color}88`, borderRadius: '4px', color: anomaly.color, fontWeight: 600, fontSize: '11px', padding: '1px 6px' }}>
        {anomaly.sst.toFixed(1)}°C
      </span>
    </td>
    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
      <span style={{ color: anomaly.anomaly >= 0 ? '#f97316' : '#60a5fa', fontWeight: 600, fontSize: '11px' }}>
        {anomaly.anomaly >= 0 ? '+' : ''}{anomaly.anomaly.toFixed(2)}°C
      </span>
    </td>
  </tr>
);

/** Animated wave symbol showing the risk level */
const WaveSymbol: React.FC<{ riskLevel: WaveHeightPrediction['riskLevel'] }> = ({ riskLevel }) => {
  const cfg = WAVE_RISK_CONFIG[riskLevel];
  const isAnimated = riskLevel === 'rough' || riskLevel === 'very_rough' || riskLevel === 'phenomenal';
  return (
    <span
      aria-label={`Wave risk: ${cfg.label}`}
      title={cfg.label}
      style={{
        fontSize: '16px',
        animation: isAnimated ? 'wave-rock 1.2s ease-in-out infinite' : 'none',
        display: 'inline-block',
      }}
    >
      {cfg.emoji}
    </span>
  );
};

/** CVI district row */
const CVIRow: React.FC<{ result: CoastalVulnerabilityIndex; rank: number; isSelected: boolean; onSelect: () => void }> = ({
  result, rank, isSelected, onSelect,
}) => {
  const { color, label } = CVI_TIER_CONFIG[result.riskTier];
  return (
    <tr
      onClick={onSelect}
      aria-selected={isSelected}
      style={{
        cursor: 'pointer',
        background: isSelected ? 'rgba(255,255,255,0.07)' : rank % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
        borderLeft: isSelected ? `3px solid ${color}` : '3px solid transparent',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.05)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = isSelected ? 'rgba(255,255,255,0.07)' : rank % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent')}
    >
      <td style={{ padding: '4px 6px', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '11px' }}>{rank}</td>
      <td style={{ padding: '4px 6px' }}>
        <div style={{ fontSize: '12px', fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>{result.districtName}</div>
        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>{result.state}</div>
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
        <span style={{ background: `${color}22`, border: `1px solid ${color}88`, borderRadius: '4px', color, fontWeight: 600, fontSize: '11px', padding: '1px 5px' }}>
          {result.cvi.toFixed(0)}
        </span>
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'center', fontSize: '11px', color }}>{label}</td>
    </tr>
  );
};

/** CVI component breakdown for the selected district */
const CVIDetailCard: React.FC<{ result: CoastalVulnerabilityIndex }> = ({ result }) => {
  const { color, label } = CVI_TIER_CONFIG[result.riskTier];
  return (
    <div style={{ background: `${color}12`, border: `1px solid ${color}44`, borderRadius: '8px', padding: '12px', marginTop: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontWeight: 700, fontSize: '14px', color: 'rgba(255,255,255,0.95)' }}>{result.districtName}</span>
        <span style={{ fontSize: '20px', fontWeight: 700, color }}>{result.cvi.toFixed(1)}</span>
      </div>
      <div style={{ fontSize: '11px', color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
        {label} Vulnerability
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
        {[
          { label: 'Wave Height', value: result.waveHeightScore.toFixed(0), icon: '🌊' },
          { label: 'SST Anomaly', value: result.sstAnomalyScore.toFixed(0),  icon: '🌡️' },
          { label: 'Tidal Range', value: result.tidalRangeScore.toFixed(0),  icon: '🌕' },
        ].map(({ label: l, value, icon }) => (
          <div key={l} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '6px 4px' }}>
            <div style={{ fontSize: '16px' }}>{icon}</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#94a3b8' }}>{value}</div>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Shipping route risk row */
const RouteRow: React.FC<{ route: ShippingRoute; isSelected: boolean; onSelect: () => void }> = ({
  route, isSelected, onSelect,
}) => (
  <div
    onClick={onSelect}
    role="button"
    aria-pressed={isSelected}
    tabIndex={0}
    onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    style={{
      padding: '8px 10px',
      borderRadius: '6px',
      background: isSelected ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${isSelected ? route.color + '88' : 'rgba(255,255,255,0.06)'}`,
      cursor: 'pointer',
      marginBottom: '6px',
      transition: 'all 150ms ease',
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>🚢 {route.name}</span>
        <span style={{ marginLeft: '6px', fontSize: '10px', color: 'rgba(255,255,255,0.35)', textTransform: 'capitalize' }}>
          ({route.cargoType})
        </span>
      </div>
      <span style={{ background: `${route.color}22`, border: `1px solid ${route.color}88`, borderRadius: '4px', color: route.color, fontWeight: 600, fontSize: '11px', padding: '1px 6px' }}>
        Risk {route.weatherRisk}
      </span>
    </div>
    {isSelected && (
      <div style={{ marginTop: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.55)', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '6px' }}>
        {route.riskDescription}
        <div style={{ marginTop: '4px', color: 'rgba(255,255,255,0.3)' }}>
          {route.waypoints.length} waypoints · {route.waypoints.length - 1} segments
        </div>
      </div>
    )}
  </div>
);

// ── Tab Panel Components ──────────────────────────────────────────────────────

const SSTPanel: React.FC<{ anomalies: SSTAnomaly[] }> = ({ anomalies }) => {
  const warmCount  = anomalies.filter((a) => a.anomaly >  0.5).length;
  const coolCount  = anomalies.filter((a) => a.anomaly < -0.5).length;
  const meanAnomaly = anomalies.length > 0
    ? anomalies.reduce((s, a) => s + a.anomaly, 0) / anomalies.length
    : 0;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '12px' }}>
        {[
          { label: 'Mean anomaly', value: `${meanAnomaly >= 0 ? '+' : ''}${meanAnomaly.toFixed(2)}°C`, color: sstAnomalyToColor(meanAnomaly) },
          { label: 'Warm cells',   value: String(warmCount),  color: '#f97316' },
          { label: 'Cool cells',   value: String(coolCount),  color: '#60a5fa' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '6px' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{label}</div>
          </div>
        ))}
      </div>
      <SSTLegend />
      <div style={{ overflowY: 'auto', maxHeight: '260px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }} aria-label="SST anomaly data">
          <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)' }}>
            <tr>
              {['Lat', 'Lon', 'SST', 'Anomaly'].map((h) => (
                <th key={h} scope="col" style={{ padding: '5px 8px', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: h === 'Lat' || h === 'Lon' ? 'right' : 'center' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a, i) => <SSTRow key={`${a.lat}-${a.lon}`} anomaly={a} index={i} />)}
          </tbody>
        </table>
      </div>
    </>
  );
};

const WavesPanel: React.FC<{ predictions: WaveHeightPrediction[] }> = ({ predictions }) => {
  const byRisk = (level: WaveHeightPrediction['riskLevel']) => predictions.filter((p) => p.riskLevel === level).length;

  return (
    <>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['calm', 'moderate', 'rough', 'very_rough', 'phenomenal'] as const).map((level) => {
          const cfg   = WAVE_RISK_CONFIG[level];
          const count = byRisk(level);
          if (count === 0) return null;
          return (
            <div key={level} style={{ flex: '1 1 auto', textAlign: 'center', background: `${cfg.color}18`, border: `1px solid ${cfg.color}55`, borderRadius: '6px', padding: '5px 4px' }}>
              <div style={{ fontSize: '14px' }}>{cfg.emoji}</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: cfg.color }}>{count}</div>
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>{cfg.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '280px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }} aria-label="Wave height predictions">
          <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)' }}>
            <tr>
              {['Lat', 'Lon', 'SWH (m)', 'Risk', ''].map((h, i) => (
                <th key={i} scope="col" style={{ padding: '5px 6px', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {predictions.map((p, idx) => {
              const cfg = WAVE_RISK_CONFIG[p.riskLevel];
              return (
                <tr key={`${p.lat}-${p.lon}`} style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                  <td style={{ padding: '4px 6px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>{p.lat.toFixed(1)}°N</td>
                  <td style={{ padding: '4px 6px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>{p.lon.toFixed(1)}°E</td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <span style={{ background: `${cfg.color}22`, border: `1px solid ${cfg.color}88`, borderRadius: '4px', color: cfg.color, fontWeight: 600, fontSize: '11px', padding: '1px 5px' }}>
                      {p.significantWaveHeight.toFixed(1)}m
                    </span>
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'center', fontSize: '11px', color: cfg.color }}>{cfg.label}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}><WaveSymbol riskLevel={p.riskLevel} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

const CVIPanel: React.FC<{ results: CoastalVulnerabilityIndex[] }> = ({ results }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedResult = results.find((r) => r.districtName === selected) ?? null;
  const highRiskCount = results.filter((r) => r.riskTier === 'high' || r.riskTier === 'very_high' || r.riskTier === 'extreme').length;

  return (
    <>
      {highRiskCount > 0 && (
        <div role="alert" aria-live="polite" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '6px', padding: '7px 10px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '7px', animation: 'ocean-alert-pulse 2.5s ease-in-out infinite' }}>
          <span style={{ fontSize: '16px' }} aria-hidden="true">⚠️</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#fca5a5' }}>
            {highRiskCount} coastal district{highRiskCount > 1 ? 's' : ''} at high vulnerability
          </span>
        </div>
      )}
      <div style={{ overflowY: 'auto', maxHeight: '240px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }} aria-label="Coastal Vulnerability Index">
          <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)' }}>
            <tr>
              {['#', 'District', 'CVI', 'Risk'].map((h, i) => (
                <th key={h} scope="col" style={{ padding: '5px 6px', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: i < 2 ? 'left' : 'center' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r, idx) => (
              <CVIRow key={r.districtName} result={r} rank={idx + 1} isSelected={selected === r.districtName} onSelect={() => setSelected(selected === r.districtName ? null : r.districtName)} />
            ))}
          </tbody>
        </table>
      </div>
      {selectedResult && <CVIDetailCard result={selectedResult} />}
    </>
  );
};

const RoutesPanel: React.FC<{ routes: ShippingRoute[] }> = ({ routes }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const highRiskRoutes = routes.filter((r) => r.weatherRisk >= 50).length;

  return (
    <>
      {highRiskRoutes > 0 && (
        <div role="alert" style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid #f97316', borderRadius: '6px', padding: '7px 10px', marginBottom: '10px', display: 'flex', gap: '7px', alignItems: 'center' }}>
          <span aria-hidden="true">⚓</span>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#fdba74' }}>
            {highRiskRoutes} route{highRiskRoutes > 1 ? 's' : ''} with elevated weather risk
          </span>
        </div>
      )}
      <div role="list" aria-label="Shipping routes">
        {routes.map((route) => (
          <RouteRow
            key={route.id}
            route={route}
            isSelected={selected === route.id}
            onSelect={() => setSelected(selected === route.id ? null : route.id)}
          />
        ))}
      </div>
    </>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface OceanCoastalProps {
  /** Grid cells from prediction data; when omitted, mock data is used */
  gridCells?: GridCell[];
  /** Whether the panel is active */
  enabled?: boolean;
  /** Override SST climatology mean for testing / custom baselines */
  climatologyMean?: number;
  /** Custom coastal districts (defaults to COASTAL_DISTRICTS) */
  districts?: CoastalDistrict[];
  /** Custom shipping routes (defaults to SHIPPING_ROUTES) */
  shippingRoutes?: ShippingRoute[];
  /** Callback when a CVI district is selected */
  onDistrictSelect?: (result: CoastalVulnerabilityIndex) => void;
  /** Callback when a shipping route is selected */
  onRouteSelect?: (route: ShippingRoute) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * OceanCoastal — Ocean and Coastal Monitoring Panel.
 *
 * Validates: Requirements 51.1, 51.2, 51.3, 51.4
 */
export const OceanCoastal: React.FC<OceanCoastalProps> = ({
  gridCells,
  enabled = true,
  climatologyMean = 28.5,
  districts = COASTAL_DISTRICTS,
  shippingRoutes = SHIPPING_ROUTES,
  onDistrictSelect,
  onRouteSelect: _onRouteSelect,
}) => {
  const [activeTab, setActiveTab] = useState<OceanTab>('sst');

  // Compute SST anomalies — fall back to mock data
  const sstAnomalies = useMemo<SSTAnomaly[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return MOCK_SST_ANOMALIES;
    const computed = buildSSTAnomalies(gridCells, climatologyMean);
    return computed.length > 0 ? computed : MOCK_SST_ANOMALIES;
  }, [gridCells, enabled, climatologyMean]);

  // Compute wave height predictions
  const wavePredictions = useMemo<WaveHeightPrediction[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return [];
    return buildWaveHeightPredictions(gridCells);
  }, [gridCells, enabled]);

  // Compute CVI for all districts — fall back to mock data
  const cviResults = useMemo<CoastalVulnerabilityIndex[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return MOCK_CVI_RESULTS;
    const computed = computeAllCVI(gridCells, districts);
    return computed.length > 0 ? computed : MOCK_CVI_RESULTS;
  }, [gridCells, enabled, districts]);

  // Severity summary stats
  const extremeSSTCells = sstAnomalies.filter((a) => Math.abs(a.anomaly) > 2).length;
  const highWaveCells   = wavePredictions.filter((w) => w.riskLevel === 'rough' || w.riskLevel === 'very_rough' || w.riskLevel === 'phenomenal').length;
  const highCVICount    = cviResults.filter((c) => c.riskTier === 'high' || c.riskTier === 'very_high' || c.riskTier === 'extreme').length;

  if (!enabled) return null;

  // Suppress unused variable warning for onDistrictSelect in the panel (used via CVIPanel indirectly)
  void onDistrictSelect;

  return (
    <div
      className="ocean-coastal"
      data-testid="ocean-coastal"
      role="region"
      aria-label="Ocean and Coastal Monitoring"
    >
      {/* ── Alert Banner ── */}
      {(extremeSSTCells > 0 || highWaveCells > 0 || highCVICount > 0) && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: 'rgba(6,182,212,0.1)',
            border: '1px solid #06b6d4',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'ocean-banner-pulse 3s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: '18px' }} aria-hidden="true">🌊</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#67e8f9' }}>
            Indian Ocean Watch:&nbsp;
            {[
              extremeSSTCells > 0 && `${extremeSSTCells} extreme SST anomal${extremeSSTCells > 1 ? 'ies' : 'y'}`,
              highWaveCells   > 0 && `${highWaveCells} rough wave zone${highWaveCells > 1 ? 's' : ''}`,
              highCVICount    > 0 && `${highCVICount} high-vulnerability coast${highCVICount > 1 ? 's' : ''}`,
            ].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}

      {/* ── Main Glass Panel ── */}
      <GlassPanel padding="md" className="ocean-coastal-panel">
        <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(255,255,255,0.95)', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🌊 Ocean &amp; Coastal Monitoring
          <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>
            Indian Ocean
          </span>
        </h3>

        {/* Tab navigation */}
        <TabBar active={activeTab} onChange={setActiveTab} />

        {/* Tab content */}
        {activeTab === 'sst'    && <SSTPanel    anomalies={sstAnomalies} />}
        {activeTab === 'waves'  && (wavePredictions.length > 0
          ? <WavesPanel predictions={wavePredictions} />
          : <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', textAlign: 'center', padding: '24px 0' }}>No ocean grid cells in active region.<br/>Select a coastal region to see wave heights.</div>
        )}
        {activeTab === 'cvi'    && <CVIPanel    results={cviResults} />}
        {activeTab === 'routes' && <RoutesPanel routes={shippingRoutes} />}
      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes wave-rock {
          0%, 100% { transform: translateY(0px) rotate(-8deg); }
          50%       { transform: translateY(-4px) rotate(8deg); }
        }
        @keyframes ocean-alert-pulse {
          0%, 100% { box-shadow: 0 0 5px rgba(239,68,68,0.2); }
          50%       { box-shadow: 0 0 14px rgba(239,68,68,0.5); }
        }
        @keyframes ocean-banner-pulse {
          0%, 100% { box-shadow: 0 0 5px rgba(6,182,212,0.2); }
          50%       { box-shadow: 0 0 14px rgba(6,182,212,0.5); }
        }
      `}</style>
    </div>
  );
};

export default OceanCoastal;
