/**
 * PopulationExposure — Population Exposure Analysis.
 *
 * Exports pure functions for exposure computation (testable), plus a React component:
 *  1. WorldPop/census density overlay data for the globe
 *  2. Affected population count per hazard zone displayed in the risk panel
 *  3. "Most Vulnerable Areas" priority list ranked by exposure
 *  4. Population-weighted average climate risk scores per district
 *
 * Population density is approximated using a synthetic grid seeded from
 * publicly available census district data for India. In production this
 * would be replaced by a WorldPop raster tile API call.
 *
 * Validates: Requirements 62.1, 62.2, 62.3, 62.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, RegionId } from '../../types';
import type { HazardScores } from './ClimateProjections';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Hazard types that drive exposure assessment */
export type HazardType = 'flood' | 'heatwave' | 'cyclone' | 'drought';

/** A single hazard zone with its estimated exposed population */
export interface HazardZoneExposure {
  /** Unique identifier combining hazard + grid-cell */
  id: string;
  hazardType: HazardType;
  lat: number;
  lon: number;
  /** Grid-cell population density (persons / km²) */
  densityPerKm2: number;
  /** Area of one 0.25° × 0.25° cell in km² (varies with latitude) */
  cellAreaKm2: number;
  /** Estimated exposed population = density × area */
  exposedPopulation: number;
  /** Severity label for the hazard (e.g. 'High', 'Extreme') */
  severity: string;
}

/** District-level population-weighted risk score */
export interface DistrictPopWeightedRisk {
  district: string;
  state: string;
  /** Un-weighted composite risk score (0–100) from ClimateProjections */
  rawRiskScore: number;
  /** Sum of exposed population across all grid cells in this district */
  totalExposedPopulation: number;
  /** Population-weighted risk score = Σ(risk_i × pop_i) / Σ(pop_i) */
  populationWeightedScore: number;
  /** Component hazard scores for reference */
  components: HazardScores;
}

/** A grid cell annotated with population density for the globe overlay */
export interface PopDensityCell {
  lat: number;
  lon: number;
  densityPerKm2: number;
  /** CSS colour from the density palette */
  color: string;
}

// ── District population data (census approximation) ───────────────────────────

/**
 * Representative major Indian districts with approximate population density
 * (persons/km²) from Census 2011 + WorldPop estimates.
 *
 * Key fields:
 *   district, state, lat, lon — geographic centre
 *   densityPerKm2             — population density
 *   radiusDeg                 — coverage radius in degrees for grid-cell assignment
 *   components                — hazard scores (mirrors ClimateProjections mock data)
 *
 * Requirement 62.1: overlay census/WorldPop density data on the climate grid.
 */
export interface DistrictDefinition {
  district: string;
  state: string;
  lat: number;
  lon: number;
  densityPerKm2: number;
  radiusDeg: number;
  components: HazardScores;
}

export const DISTRICT_DEFINITIONS: DistrictDefinition[] = [
  { district: 'Puri',       state: 'Odisha',           lat: 19.81, lon: 85.83, densityPerKm2: 870,  radiusDeg: 0.75, components: { flood: 85, drought: 30, heatwave: 72, cyclone: 95 } },
  { district: 'Kendrapara', state: 'Odisha',           lat: 20.50, lon: 86.42, densityPerKm2: 620,  radiusDeg: 0.75, components: { flood: 90, drought: 25, heatwave: 68, cyclone: 88 } },
  { district: 'Balasore',   state: 'Odisha',           lat: 21.49, lon: 86.93, densityPerKm2: 580,  radiusDeg: 0.75, components: { flood: 78, drought: 28, heatwave: 65, cyclone: 82 } },
  { district: 'Sivasagar',  state: 'Assam',            lat: 26.98, lon: 94.64, densityPerKm2: 310,  radiusDeg: 0.75, components: { flood: 92, drought: 20, heatwave: 55, cyclone: 15 } },
  { district: 'Dibrugarh',  state: 'Assam',            lat: 27.48, lon: 94.91, densityPerKm2: 390,  radiusDeg: 0.75, components: { flood: 88, drought: 22, heatwave: 58, cyclone: 12 } },
  { district: 'Lakhimpur',  state: 'Assam',            lat: 27.23, lon: 94.10, densityPerKm2: 420,  radiusDeg: 0.75, components: { flood: 84, drought: 24, heatwave: 52, cyclone: 10 } },
  { district: 'Nalgonda',   state: 'Telangana',        lat: 17.05, lon: 79.26, densityPerKm2: 210,  radiusDeg: 0.75, components: { flood: 35, drought: 88, heatwave: 90, cyclone:  5 } },
  { district: 'Anantapur',  state: 'Andhra Pradesh',   lat: 14.68, lon: 77.60, densityPerKm2: 140,  radiusDeg: 0.75, components: { flood: 28, drought: 92, heatwave: 88, cyclone:  8 } },
  { district: 'Kurnool',    state: 'Andhra Pradesh',   lat: 15.83, lon: 78.04, densityPerKm2: 170,  radiusDeg: 0.75, components: { flood: 42, drought: 85, heatwave: 86, cyclone: 12 } },
  { district: 'Vidisha',    state: 'Madhya Pradesh',   lat: 23.52, lon: 77.81, densityPerKm2: 180,  radiusDeg: 0.75, components: { flood: 55, drought: 70, heatwave: 82, cyclone:  5 } },
  { district: 'Banda',      state: 'Uttar Pradesh',    lat: 25.48, lon: 80.33, densityPerKm2: 240,  radiusDeg: 0.75, components: { flood: 48, drought: 75, heatwave: 84, cyclone:  4 } },
  { district: 'Ratnagiri',  state: 'Maharashtra',      lat: 16.99, lon: 73.30, densityPerKm2: 110,  radiusDeg: 0.75, components: { flood: 72, drought: 20, heatwave: 55, cyclone: 48 } },
  { district: 'Kannur',     state: 'Kerala',           lat: 11.87, lon: 75.37, densityPerKm2: 760,  radiusDeg: 0.75, components: { flood: 68, drought: 18, heatwave: 45, cyclone: 35 } },
  { district: 'Patna',      state: 'Bihar',            lat: 25.59, lon: 85.13, densityPerKm2:1802,  radiusDeg: 0.75, components: { flood: 78, drought: 42, heatwave: 78, cyclone:  8 } },
  { district: 'Varanasi',   state: 'Uttar Pradesh',    lat: 25.32, lon: 83.01, densityPerKm2:2395,  radiusDeg: 0.75, components: { flood: 62, drought: 48, heatwave: 80, cyclone:  5 } },
  { district: 'Jaisalmer',  state: 'Rajasthan',        lat: 26.91, lon: 70.91, densityPerKm2:  17,  radiusDeg: 1.0,  components: { flood: 12, drought: 96, heatwave: 95, cyclone:  2 } },
  { district: 'Barmer',     state: 'Rajasthan',        lat: 25.75, lon: 71.39, densityPerKm2:  52,  radiusDeg: 1.0,  components: { flood: 15, drought: 94, heatwave: 93, cyclone:  4 } },
  { district: 'Shimla',     state: 'Himachal Pradesh', lat: 31.10, lon: 77.17, densityPerKm2: 159,  radiusDeg: 0.75, components: { flood: 35, drought: 32, heatwave: 22, cyclone:  5 } },
];

// ── Constants ─────────────────────────────────────────────────────────────────

/** Earth's mean radius in km — used for cell-area computation */
const EARTH_RADIUS_KM = 6371;

/** Degrees to radians conversion factor */
const DEG_TO_RAD = Math.PI / 180;

/**
 * Threshold above which a hazard exposure entry is shown in the "Most
 * Vulnerable Areas" priority list.  Requirement 62.3.
 */
export const VULNERABILITY_DISPLAY_THRESHOLD = 10_000; // persons

/**
 * Severity label for a hazard score value.
 */
export function hazardSeverityLabel(score: number): string {
  if (score >= 90) return 'Extreme';
  if (score >= 70) return 'High';
  if (score >= 50) return 'Moderate';
  if (score >= 30) return 'Low';
  return 'Minimal';
}

// ── Pure Computation Functions (exported for testing) ─────────────────────────

/**
 * Compute the area (km²) of a 0.25° × 0.25° grid cell at a given latitude.
 *
 * Area = (R × Δlat) × (R × cos(lat) × Δlon)
 * where Δlat = Δlon = 0.25° and R is Earth's radius.
 *
 * Requirement 62.1: needed to convert density → absolute population.
 */
export function cellAreaKm2(latDeg: number, cellSizeDeg = 0.25): number {
  const latRad = latDeg * DEG_TO_RAD;
  const deltaRad = cellSizeDeg * DEG_TO_RAD;
  return EARTH_RADIUS_KM * EARTH_RADIUS_KM * deltaRad * deltaRad * Math.cos(latRad);
}

/**
 * Estimate the population density (persons/km²) at a grid-cell location
 * by interpolating from the nearest district definition.
 *
 * Uses a simple inverse-distance weighting approach over the closest
 * three districts (adequate for 0.25° resolution).
 *
 * Requirement 62.1: overlay census/WorldPop density on the climate grid.
 */
export function estimateDensityAtCell(
  lat: number,
  lon: number,
  districts: DistrictDefinition[] = DISTRICT_DEFINITIONS,
): number {
  // Euclidean distance in degree space (cheap, adequate for this resolution)
  const distances = districts.map((d) => ({
    density: d.densityPerKm2,
    dist: Math.sqrt((lat - d.lat) ** 2 + (lon - d.lon) ** 2) + 1e-9,
  }));
  distances.sort((a, b) => a.dist - b.dist);

  // Inverse-distance weighting with k=3 nearest
  const k = Math.min(3, distances.length);
  const nearest = distances.slice(0, k);
  const sumWeights = nearest.reduce((s, n) => s + 1 / n.dist, 0);
  const weightedDensity = nearest.reduce((s, n) => s + n.density / n.dist, 0);
  return sumWeights > 0 ? weightedDensity / sumWeights : 0;
}

/**
 * Map a population density (persons/km²) to a CSS colour on a
 * light-blue → deep-purple palette (representing sparsely to densely
 * populated areas).
 *
 * Requirement 62.1: density overlay on globe.
 */
export function densityToColor(densityPerKm2: number): string {
  // Log scale: 0 → 2500+ persons/km²
  const t = Math.min(1, Math.log10(Math.max(1, densityPerKm2)) / Math.log10(2500));
  if (t < 0.33) {
    // very sparse: near-transparent cyan
    const u = t / 0.33;
    const r = Math.round(200 - u * 100);
    const g = Math.round(230 - u * 50);
    const b = Math.round(255);
    return `rgba(${r},${g},${b},${0.25 + u * 0.35})`;
  }
  if (t < 0.66) {
    const u = (t - 0.33) / 0.33;
    const r = Math.round(100 - u * 60);
    const g = Math.round(180 - u * 80);
    const b = Math.round(255 - u * 30);
    return `rgba(${r},${g},${b},${0.6 + u * 0.2})`;
  }
  // dense: deep purple
  const u = (t - 0.66) / 0.34;
  const r = Math.round(40 + u * 80);
  const g = Math.round(100 - u * 60);
  const b = Math.round(225 - u * 55);
  return `rgba(${r},${g},${b},0.85)`;
}

/**
 * Build the population density overlay cells from the provided grid.
 *
 * Requirement 62.1: overlay census/WorldPop density data.
 */
export function buildPopDensityOverlay(
  gridCells: GridCell[],
  districts: DistrictDefinition[] = DISTRICT_DEFINITIONS,
): PopDensityCell[] {
  return gridCells.map((cell) => {
    const density = estimateDensityAtCell(cell.lat, cell.lon, districts);
    return {
      lat: cell.lat,
      lon: cell.lon,
      densityPerKm2: density,
      color: densityToColor(density),
    };
  });
}

/**
 * Compute population exposure for each hazard-affected grid cell.
 *
 * `hazardCells` — grid cells flagged as part of a hazard zone, each
 *   carrying a `hazardType` and `severity` label.
 *
 * Returns HazardZoneExposure records sorted by exposedPopulation descending.
 *
 * Requirement 62.2: display estimated affected population count per hazard zone.
 */
export function computeHazardExposure(
  hazardCells: Array<GridCell & { hazardType: HazardType; severity: string }>,
  districts: DistrictDefinition[] = DISTRICT_DEFINITIONS,
): HazardZoneExposure[] {
  const results: HazardZoneExposure[] = hazardCells.map((cell, idx) => {
    const density = estimateDensityAtCell(cell.lat, cell.lon, districts);
    const area = cellAreaKm2(cell.lat);
    const exposedPopulation = density * area;
    return {
      id: `${cell.hazardType}-${cell.node_idx ?? idx}`,
      hazardType: cell.hazardType,
      lat: cell.lat,
      lon: cell.lon,
      densityPerKm2: density,
      cellAreaKm2: area,
      exposedPopulation,
      severity: cell.severity,
    };
  });

  // Sort descending by exposure (Requirement 62.3 ranking basis)
  return results.sort((a, b) => b.exposedPopulation - a.exposedPopulation);
}

/**
 * Aggregate total exposed population per hazard type.
 *
 * Returns a map from HazardType → total affected persons.
 * Requirement 62.2: show affected count in risk panel.
 */
export function totalExposureByHazard(
  exposures: HazardZoneExposure[],
): Record<HazardType, number> {
  const totals: Record<HazardType, number> = {
    flood: 0,
    heatwave: 0,
    cyclone: 0,
    drought: 0,
  };
  for (const e of exposures) {
    totals[e.hazardType] += e.exposedPopulation;
  }
  return totals;
}

/**
 * Build the "Most Vulnerable Areas" ranked priority list.
 *
 * Each entry represents one grid cell in a hazard zone; entries are
 * sorted by exposedPopulation descending and filtered to those above
 * VULNERABILITY_DISPLAY_THRESHOLD.
 *
 * Requirement 62.3: rank areas by exposure and display priority list.
 */
export function mostVulnerableAreas(
  exposures: HazardZoneExposure[],
  limit = 20,
): HazardZoneExposure[] {
  return exposures
    .filter((e) => e.exposedPopulation >= VULNERABILITY_DISPLAY_THRESHOLD)
    .slice(0, limit);
}

/**
 * Compute population-weighted average climate risk scores per district.
 *
 * For each district definition:
 *   1. Select grid cells within the district's coverage radius
 *   2. Compute per-cell exposed population (density × area)
 *   3. Compute population-weighted average risk =
 *        Σ(risk_i × pop_i) / Σ(pop_i)
 *      where risk_i is a linear combination of hazard scores.
 *
 * If no grid cells fall within a district, the raw composite score is
 * returned as-is (equal-weight fallback).
 *
 * Requirement 62.4: compute population-weighted average risk scores per district.
 */
export function computePopWeightedDistrictRisk(
  gridCells: GridCell[],
  districts: DistrictDefinition[] = DISTRICT_DEFINITIONS,
): DistrictPopWeightedRisk[] {
  return districts.map((dist) => {
    // Gather grid cells within this district's radius
    const inDistrict = gridCells.filter((cell) => {
      const d = Math.sqrt((cell.lat - dist.lat) ** 2 + (cell.lon - dist.lon) ** 2);
      return d <= dist.radiusDeg;
    });

    // Raw composite risk (equal-weight average of components as a proxy)
    const rawRiskScore =
      (dist.components.flood * 0.35 +
        dist.components.drought * 0.25 +
        dist.components.heatwave * 0.25 +
        dist.components.cyclone * 0.15);

    if (inDistrict.length === 0) {
      return {
        district: dist.district,
        state: dist.state,
        rawRiskScore,
        totalExposedPopulation: 0,
        populationWeightedScore: rawRiskScore,
        components: dist.components,
      };
    }

    // For each in-district cell, compute a simple risk score from the
    // cell's rainfall/temp deviation from regional mean as a proxy for
    // current hazard intensity.
    const regionMeanRainfall =
      inDistrict.reduce((s, c) => s + c.rainfall, 0) / inDistrict.length;

    let totalPop = 0;
    let weightedScore = 0;

    for (const cell of inDistrict) {
      const density = dist.densityPerKm2;
      const area = cellAreaKm2(cell.lat);
      const pop = density * area;
      // Blend district raw risk with cell-level rainfall anomaly factor
      const rainfallFactor = regionMeanRainfall > 0
        ? Math.min(1.5, cell.rainfall / regionMeanRainfall)
        : 1;
      const cellRisk = Math.min(100, rawRiskScore * rainfallFactor);
      totalPop += pop;
      weightedScore += cellRisk * pop;
    }

    const populationWeightedScore = totalPop > 0
      ? Math.min(100, weightedScore / totalPop)
      : rawRiskScore;

    return {
      district: dist.district,
      state: dist.state,
      rawRiskScore,
      totalExposedPopulation: totalPop,
      populationWeightedScore,
      components: dist.components,
    };
  }).sort((a, b) => b.populationWeightedScore - a.populationWeightedScore);
}

// ── Mock hazard-zone data (demo/fallback) ─────────────────────────────────────

/**
 * Synthetic hazard zone cells derived from the district definitions.
 * Used when no real-time hazard cells are provided to the component.
 */
export const MOCK_HAZARD_CELLS: Array<GridCell & { hazardType: HazardType; severity: string }> = [
  { lat: 19.81, lon: 85.83, node_idx: 0, rainfall: 280, temp_max: 36, temp_min: 27, rainfall_uncertainty: 20, temp_max_uncertainty: 1.2, temp_min_uncertainty: 0.8, hazardType: 'cyclone',  severity: 'Extreme' },
  { lat: 20.50, lon: 86.42, node_idx: 1, rainfall: 260, temp_max: 35, temp_min: 26, rainfall_uncertainty: 18, temp_max_uncertainty: 1.0, temp_min_uncertainty: 0.7, hazardType: 'flood',    severity: 'High' },
  { lat: 26.98, lon: 94.64, node_idx: 2, rainfall: 310, temp_max: 34, temp_min: 25, rainfall_uncertainty: 25, temp_max_uncertainty: 1.5, temp_min_uncertainty: 1.0, hazardType: 'flood',    severity: 'Extreme' },
  { lat: 27.48, lon: 94.91, node_idx: 3, rainfall: 295, temp_max: 33, temp_min: 24, rainfall_uncertainty: 22, temp_max_uncertainty: 1.3, temp_min_uncertainty: 0.9, hazardType: 'flood',    severity: 'High' },
  { lat: 17.05, lon: 79.26, node_idx: 4, rainfall:  12, temp_max: 44, temp_min: 32, rainfall_uncertainty:  5, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.5, hazardType: 'heatwave', severity: 'Extreme' },
  { lat: 14.68, lon: 77.60, node_idx: 5, rainfall:   8, temp_max: 43, temp_min: 31, rainfall_uncertainty:  4, temp_max_uncertainty: 0.9, temp_min_uncertainty: 0.6, hazardType: 'drought',  severity: 'High' },
  { lat: 25.59, lon: 85.13, node_idx: 6, rainfall: 190, temp_max: 38, temp_min: 28, rainfall_uncertainty: 15, temp_max_uncertainty: 1.1, temp_min_uncertainty: 0.7, hazardType: 'flood',    severity: 'Moderate' },
  { lat: 25.32, lon: 83.01, node_idx: 7, rainfall: 160, temp_max: 40, temp_min: 30, rainfall_uncertainty: 14, temp_max_uncertainty: 1.0, temp_min_uncertainty: 0.6, hazardType: 'heatwave', severity: 'High' },
  { lat: 16.99, lon: 73.30, node_idx: 8, rainfall: 220, temp_max: 34, temp_min: 24, rainfall_uncertainty: 18, temp_max_uncertainty: 0.9, temp_min_uncertainty: 0.5, hazardType: 'cyclone',  severity: 'Moderate' },
  { lat: 11.87, lon: 75.37, node_idx: 9, rainfall: 195, temp_max: 33, temp_min: 25, rainfall_uncertainty: 16, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.5, hazardType: 'flood',    severity: 'High' },
];

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Format a raw population count into a human-readable string.
 * e.g. 1_234_567 → "1.23 M"
 */
export function formatPopulation(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)} M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)} K`;
  return count.toFixed(0);
}

/** Colour for each hazard type */
export const HAZARD_COLORS: Record<HazardType, string> = {
  flood:    '#3b82f6',
  heatwave: '#f97316',
  cyclone:  '#a78bfa',
  drought:  '#fbbf24',
};

/** Emoji icon for each hazard type */
export const HAZARD_ICONS: Record<HazardType, string> = {
  flood:    '🌊',
  heatwave: '🌡️',
  cyclone:  '🌀',
  drought:  '☀️',
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Summary chip showing total exposed population per hazard type */
const HazardTotalChip: React.FC<{ hazard: HazardType; total: number }> = ({ hazard, total }) => {
  const color = HAZARD_COLORS[hazard];
  const icon = HAZARD_ICONS[hazard];
  return (
    <div
      style={{
        background: `${color}15`,
        border: `1px solid ${color}55`,
        borderRadius: 'var(--radius-sm, 6px)',
        padding: '6px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        minWidth: '90px',
      }}
    >
      <span style={{ fontSize: '18px' }} aria-hidden="true">{icon}</span>
      <span style={{ fontSize: '11px', color, fontWeight: 700, textTransform: 'capitalize' }}>{hazard}</span>
      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
        {formatPopulation(total)}
      </span>
    </div>
  );
};

/** Single row in the "Most Vulnerable Areas" list */
const VulnerableAreaRow: React.FC<{ entry: HazardZoneExposure; rank: number }> = ({ entry, rank }) => {
  const color = HAZARD_COLORS[entry.hazardType];
  const icon = HAZARD_ICONS[entry.hazardType];
  return (
    <tr
      style={{ borderLeft: `3px solid ${color}`, background: rank % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
    >
      <td style={{ padding: '5px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '11px' }}>
        {rank}
      </td>
      <td style={{ padding: '5px 8px', fontSize: '12px', color: 'rgba(255,255,255,0.8)' }}>
        <span aria-hidden="true">{icon} </span>
        ({entry.lat.toFixed(2)}°, {entry.lon.toFixed(2)}°)
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
        <span
          style={{
            background: `${color}22`,
            border: `1px solid ${color}`,
            borderRadius: '4px',
            color,
            fontWeight: 600,
            fontSize: '11px',
            padding: '1px 6px',
            textTransform: 'capitalize',
          }}
        >
          {entry.hazardType}
        </span>
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
        {formatPopulation(entry.exposedPopulation)}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
        {entry.severity}
      </td>
    </tr>
  );
};

/** Row in the population-weighted district risk table */
const DistrictRiskRow: React.FC<{ d: DistrictPopWeightedRisk; rank: number; isSelected: boolean; onSelect: () => void }> = ({ d, rank, isSelected, onSelect }) => {
  const scoreColor = d.populationWeightedScore >= 75 ? '#ef4444'
    : d.populationWeightedScore >= 50 ? '#f97316'
    : d.populationWeightedScore >= 25 ? '#eab308'
    : '#22c55e';
  return (
    <tr
      onClick={onSelect}
      aria-selected={isSelected}
      style={{
        cursor: 'pointer',
        background: isSelected ? 'rgba(255,255,255,0.08)' : rank % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
        borderLeft: isSelected ? `3px solid ${scoreColor}` : '3px solid transparent',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.06)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = isSelected ? 'rgba(255,255,255,0.08)' : rank % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent')}
    >
      <td style={{ padding: '5px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '11px' }}>{rank}</td>
      <td style={{ padding: '5px 8px' }}>
        <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontSize: '12px' }}>{d.district}</span>
        <span style={{ marginLeft: '5px', color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>{d.state}</span>
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
        <span style={{ color: scoreColor, fontWeight: 700, fontSize: '12px' }}>
          {d.populationWeightedScore.toFixed(1)}
        </span>
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
        {formatPopulation(d.totalExposedPopulation)}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
        {d.rawRiskScore.toFixed(0)}
      </td>
    </tr>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PopulationExposureProps {
  /**
   * Current forecast grid cells — used to derive population-weighted risk
   * scores.  Falls back to synthetic district-centre data when omitted.
   */
  gridCells?: GridCell[];
  /**
   * Hazard-affected grid cells annotated with hazardType and severity.
   * Falls back to MOCK_HAZARD_CELLS when omitted.
   */
  hazardCells?: Array<GridCell & { hazardType: HazardType; severity: string }>;
  /** Active region (used for display context only) */
  region?: RegionId;
  /** Whether the panel is active */
  enabled?: boolean;
  /**
   * Called with the full population density overlay for the globe renderer.
   * Requirement 62.1.
   */
  onOverlayReady?: (cells: PopDensityCell[]) => void;
  /** Called when the user selects a district row. */
  onDistrictSelect?: (district: DistrictPopWeightedRisk) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * PopulationExposure — Population Exposure Analysis Panel.
 *
 * Validates: Requirements 62.1, 62.2, 62.3, 62.4
 */
export const PopulationExposure: React.FC<PopulationExposureProps> = ({
  gridCells,
  hazardCells,
  enabled = true,
  onOverlayReady,
  onDistrictSelect,
}) => {
  const [activeTab, setActiveTab] = useState<'hazard' | 'vulnerable' | 'district'>('hazard');
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  // --- Req 62.2: hazard zone exposure -----------------------------------------
  const resolvedHazardCells = hazardCells ?? MOCK_HAZARD_CELLS;
  const exposures = useMemo(
    () => computeHazardExposure(resolvedHazardCells),
    [resolvedHazardCells],
  );

  const totalsByHazard = useMemo(
    () => totalExposureByHazard(exposures),
    [exposures],
  );

  const grandTotal = useMemo(
    () => Object.values(totalsByHazard).reduce((s, v) => s + v, 0),
    [totalsByHazard],
  );

  // --- Req 62.3: most vulnerable areas ----------------------------------------
  const topVulnerable = useMemo(
    () => mostVulnerableAreas(exposures),
    [exposures],
  );

  // --- Req 62.4: population-weighted district risk ----------------------------
  const districtRisks = useMemo(
    () => computePopWeightedDistrictRisk(gridCells ?? [], DISTRICT_DEFINITIONS),
    [gridCells],
  );

  // --- Req 62.1: density overlay ----------------------------------------------
  React.useEffect(() => {
    if (!onOverlayReady || !gridCells || gridCells.length === 0) return;
    const overlay = buildPopDensityOverlay(gridCells);
    onOverlayReady(overlay);
  }, [gridCells, onOverlayReady]);

  const handleDistrictSelect = (d: DistrictPopWeightedRisk) => {
    setSelectedDistrict((prev) => (prev === d.district ? null : d.district));
    onDistrictSelect?.(d);
  };

  if (!enabled) return null;

  return (
    <div
      className="population-exposure"
      data-testid="population-exposure"
      role="region"
      aria-label="Population Exposure Analysis"
    >
      {/* ── Summary banner ── */}
      <div
        role="status"
        aria-live="polite"
        style={{
          background: 'rgba(139, 92, 246, 0.12)',
          border: '1px solid #8b5cf6',
          borderRadius: 'var(--radius-md, 8px)',
          padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
          marginBottom: 'var(--space-md, 12px)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'pop-banner-pulse 3s ease-in-out infinite',
        }}
      >
        <span style={{ fontSize: '20px' }} aria-hidden="true">👥</span>
        <div>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#c4b5fd' }}>
            {formatPopulation(grandTotal)} people exposed
          </span>
          <span style={{ marginLeft: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
            across {exposures.length} hazard zones
          </span>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
          WorldPop / Census 2011
        </span>
      </div>

      <GlassPanel padding="md" className="pop-exposure-panel">
        <h3
          style={{
            fontSize: 'var(--font-heading-sm, 18px)',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.95)',
            margin: '0 0 var(--space-md, 12px) 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          🗺️ Population Exposure Analysis
        </h3>

        {/* Hazard totals row — Req 62.2 */}
        <div
          aria-label="Affected population by hazard type"
          style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: 'var(--space-md, 12px)' }}
        >
          {(Object.keys(totalsByHazard) as HazardType[]).map((h) => (
            <HazardTotalChip key={h} hazard={h} total={totalsByHazard[h]} />
          ))}
        </div>

        {/* Tab selector */}
        <div
          role="tablist"
          style={{ display: 'flex', gap: '4px', marginBottom: 'var(--space-md, 12px)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}
        >
          {([
            { key: 'hazard', label: '⚠ Hazard Zones' },
            { key: 'vulnerable', label: '📍 Most Vulnerable' },
            { key: 'district', label: '🏛 District Risk' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
              style={{
                background: activeTab === key ? 'rgba(139,92,246,0.2)' : 'transparent',
                border: activeTab === key ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-sm, 6px)',
                color: activeTab === key ? '#c4b5fd' : 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: activeTab === key ? 600 : 400,
                padding: '4px 10px',
                transition: 'all 150ms ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab: Hazard zone exposure (Req 62.2) ── */}
        {activeTab === 'hazard' && (
          <div style={{ overflowY: 'auto', maxHeight: '320px' }}>
            {exposures.length === 0 ? (
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>No hazard zones detected.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
                  <tr>
                    {['Hazard', 'Location', 'Density/km²', 'Exposed Pop.', 'Severity'].map((h) => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exposures.map((e, idx) => {
                    const color = HAZARD_COLORS[e.hazardType];
                    return (
                      <tr key={e.id} style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', borderLeft: `3px solid ${color}` }}>
                        <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '14px' }}>{HAZARD_ICONS[e.hazardType]}</td>
                        <td style={{ padding: '5px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
                          {e.lat.toFixed(2)}°, {e.lon.toFixed(2)}°
                        </td>
                        <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
                          {e.densityPerKm2.toFixed(0)}
                        </td>
                        <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 600, color }}>
                          {formatPopulation(e.exposedPopulation)}
                        </td>
                        <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                          {e.severity}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Tab: Most Vulnerable Areas (Req 62.3) ── */}
        {activeTab === 'vulnerable' && (
          <div>
            {topVulnerable.length === 0 ? (
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>
                No areas above exposure threshold ({formatPopulation(VULNERABILITY_DISPLAY_THRESHOLD)}).
              </p>
            ) : (
              <>
                <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                  Areas ranked by estimated exposed population — priority evacuation targets.
                </p>
                <div style={{ overflowY: 'auto', maxHeight: '300px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
                      <tr>
                        {['#', 'Location', 'Hazard', 'Exposed Pop.', 'Severity'].map((h) => (
                          <th key={h} style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {topVulnerable.map((entry, idx) => (
                        <VulnerableAreaRow key={entry.id} entry={entry} rank={idx + 1} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Tab: Population-Weighted District Risk (Req 62.4) ── */}
        {activeTab === 'district' && (
          <div>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
              Risk scores weighted by local population density. Higher-density districts amplify risk.
            </p>
            <div style={{ overflowY: 'auto', maxHeight: '300px' }}>
              <table
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
                aria-label="Population-weighted district climate risk scores"
              >
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
                  <tr>
                    {['#', 'District', 'Pop-Weighted', 'Exposed Pop.', 'Raw Score'].map((h) => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {districtRisks.map((d, idx) => (
                    <DistrictRiskRow
                      key={`${d.state}-${d.district}`}
                      d={d}
                      rank={idx + 1}
                      isSelected={selectedDistrict === d.district}
                      onSelect={() => handleDistrictSelect(d)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Selected district detail */}
            {selectedDistrict && (() => {
              const sel = districtRisks.find((d) => d.district === selectedDistrict);
              if (!sel) return null;
              const scoreColor = sel.populationWeightedScore >= 75 ? '#ef4444'
                : sel.populationWeightedScore >= 50 ? '#f97316'
                : sel.populationWeightedScore >= 25 ? '#eab308'
                : '#22c55e';
              return (
                <div
                  style={{
                    background: `${scoreColor}12`,
                    border: `1px solid ${scoreColor}50`,
                    borderRadius: 'var(--radius-md, 8px)',
                    padding: 'var(--space-md, 12px)',
                    marginTop: 'var(--space-md, 12px)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div>
                      <span style={{ fontSize: '16px', fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>{sel.district}</span>
                      <span style={{ marginLeft: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>{sel.state}</span>
                    </div>
                    <span style={{ fontSize: '20px', fontWeight: 700, color: scoreColor }}>
                      {sel.populationWeightedScore.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px' }}>
                    <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Exposed population: </span><span style={{ color: '#c4b5fd', fontWeight: 600 }}>{formatPopulation(sel.totalExposedPopulation)}</span></div>
                    <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Raw risk score: </span><span style={{ color: scoreColor, fontWeight: 600 }}>{sel.rawRiskScore.toFixed(1)}</span></div>
                    <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Flood: </span><span style={{ color: '#3b82f6', fontWeight: 600 }}>{sel.components.flood}</span></div>
                    <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Heat: </span><span style={{ color: '#f97316', fontWeight: 600 }}>{sel.components.heatwave}</span></div>
                    <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Drought: </span><span style={{ color: '#fbbf24', fontWeight: 600 }}>{sel.components.drought}</span></div>
                    <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Cyclone: </span><span style={{ color: '#a78bfa', fontWeight: 600 }}>{sel.components.cyclone}</span></div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes pop-banner-pulse {
          0%, 100% { box-shadow: 0 0 5px rgba(139,92,246,0.25); }
          50%       { box-shadow: 0 0 16px rgba(139,92,246,0.55); }
        }
      `}</style>
    </div>
  );
};

export default PopulationExposure;
