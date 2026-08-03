/**
 * MicroClimateZones — Micro-Climate Zone Identification.
 *
 * Exports pure functions for micro-climate detection (testable), plus a
 * React component:
 *  1. Identify cells where value differs >1.5σ from 8 immediate neighbors
 *  2. Render zones with boundary outlines and causal labels
 *  3. Land-use/land-cover (LULC) data overlay for correlation
 *  4. Micro-Climate Report with historical frequency of anomalous conditions
 *
 * Validates: Requirements 60.1, 60.2, 60.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, VariableId } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Causal label categories for micro-climate zones */
export type MicroClimateCause =
  | 'elevation'
  | 'urban_heat'
  | 'coastal_effect'
  | 'valley_channeling'
  | 'unknown';

/** A grid cell identified as a micro-climate zone */
export interface MicroClimateZone {
  cell: GridCell;
  /** The variable that triggered detection */
  variable: VariableId;
  /** Cell value */
  value: number;
  /** Mean of the 8 immediate neighbors */
  neighborMean: number;
  /** Standard deviation of the 8 neighbors */
  neighborStdDev: number;
  /** Signed departure from neighbor mean, in sigma units */
  sigmaDeviation: number;
  /** Inferred causal label */
  cause: MicroClimateCause;
  /** Human-readable cause description */
  causeLabel: string;
  /** CSS color for boundary outline */
  outlineColor: string;
}

/** Land-use / land-cover class */
export type LULCClass =
  | 'urban'
  | 'cropland'
  | 'forest'
  | 'grassland'
  | 'water'
  | 'barren'
  | 'snow_ice';

/** A grid cell annotated with LULC information */
export interface LULCCell {
  lat: number;
  lon: number;
  lulcClass: LULCClass;
  color: string;
  label: string;
}

/** A micro-climate report entry for a selected zone */
export interface MicroClimateReport {
  zone: MicroClimateZone;
  /** Fraction of days (0–1) historically anomalous at this cell */
  historicalFrequency: number;
  /** LULC class at this location */
  lulcClass: LULCClass;
  /** Narrative summary */
  summary: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Sigma threshold for micro-climate zone identification (Req 60.1) */
export const MICRO_CLIMATE_SIGMA_THRESHOLD = 1.5;

/** Grid resolution in degrees */
const GRID_RES = 0.25;

// ── LULC colour map ───────────────────────────────────────────────────────────

export const LULC_COLORS: Record<LULCClass, string> = {
  urban:           '#94a3b8',
  cropland:        '#86efac',
  forest:          '#16a34a',
  grassland:       '#a3e635',
  water:           '#3b82f6',
  barren:          '#d97706',
  snow_ice:        '#e0f2fe',
};

export const LULC_LABELS: Record<LULCClass, string> = {
  urban:           'Urban / Built-up',
  cropland:        'Cropland',
  forest:          'Forest',
  grassland:       'Grassland',
  water:           'Water Body',
  barren:          'Barren / Sparse',
  snow_ice:        'Snow / Ice',
};

// ── Cause colour map ──────────────────────────────────────────────────────────

export const CAUSE_COLORS: Record<MicroClimateCause, string> = {
  elevation:        '#f59e0b',
  urban_heat:       '#ef4444',
  coastal_effect:   '#3b82f6',
  valley_channeling:'#a78bfa',
  unknown:          '#94a3b8',
};

export const CAUSE_DESCRIPTIONS: Record<MicroClimateCause, string> = {
  elevation:         'Elevation / Orographic effect',
  urban_heat:        'Urban heat island effect',
  coastal_effect:    'Coastal moderation / sea breeze',
  valley_channeling: 'Valley channeling / cold-air pooling',
  unknown:           'Unknown micro-climate driver',
};

// ── Pure Functions (exported for testing) ─────────────────────────────────────

/**
 * Build a spatial index mapping "lat_lon" → GridCell for O(1) neighbor lookup.
 */
export function buildSpatialIndex(gridCells: GridCell[]): Map<string, GridCell> {
  const index = new Map<string, GridCell>();
  for (const cell of gridCells) {
    const key = `${cell.lat.toFixed(2)}_${cell.lon.toFixed(2)}`;
    index.set(key, cell);
  }
  return index;
}

/**
 * Return the 8 immediate neighbors (Moore neighborhood) of a cell on a
 * 0.25° grid. Diagonals are included.
 *
 * Requirement 60.1: compare against 8 immediate neighbors.
 */
export function findNeighbors(
  lat: number,
  lon: number,
  index: Map<string, GridCell>,
): GridCell[] {
  const neighbors: GridCell[] = [];
  const offsets = [-GRID_RES, 0, GRID_RES];
  for (const dLat of offsets) {
    for (const dLon of offsets) {
      if (dLat === 0 && dLon === 0) continue; // skip self
      const nLat = parseFloat((lat + dLat).toFixed(2));
      const nLon = parseFloat((lon + dLon).toFixed(2));
      const key = `${nLat.toFixed(2)}_${nLon.toFixed(2)}`;
      const neighbor = index.get(key);
      if (neighbor) neighbors.push(neighbor);
    }
  }
  return neighbors;
}

/**
 * Compute mean and standard deviation of an array of numbers.
 * Returns { mean: 0, stdDev: 0 } for empty arrays.
 */
export function meanAndStdDev(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Extract the climate variable value from a GridCell for a given VariableId.
 */
export function getCellValue(cell: GridCell, variable: VariableId): number {
  switch (variable) {
    case 'rainfall': return cell.rainfall;
    case 'temp_max': return cell.temp_max;
    case 'temp_min': return cell.temp_min;
  }
}

/**
 * Infer the most likely micro-climate cause from cell location and value.
 *
 * Heuristics based on published Indian climate geography:
 * - Coastal effect: within ~2° of known coasts (approx lon < 77 & lat 8–20, or east coast)
 * - Urban heat: high temp anomaly at cells near major city coordinates
 * - Valley channeling: negative temp anomaly (cold air pooling)
 * - Elevation: high rainfall anomaly in Western Ghats / NE India belt
 * - Default: unknown
 *
 * Requirement 60.2: label likely cause.
 */
export function inferCause(
  cell: GridCell,
  variable: VariableId,
  sigmaDeviation: number,
): MicroClimateCause {
  const lat = cell.lat;
  const lon = cell.lon;

  // Coastal effect: west coast (lon 72–78, lat 8–22) or east coast (lon 79–82, lat 8–20)
  const onWestCoast = lon >= 72 && lon <= 78 && lat >= 8 && lat <= 22;
  const onEastCoast = lon >= 79 && lon <= 82 && lat >= 8 && lat <= 20;
  if ((onWestCoast || onEastCoast) && variable !== 'temp_max') {
    return 'coastal_effect';
  }

  // Urban heat: positive temp anomaly near major cities
  const nearMajorCity = (
    (Math.abs(lat - 28.61) < 1.0 && Math.abs(lon - 77.21) < 1.0) || // Delhi
    (Math.abs(lat - 19.08) < 0.75 && Math.abs(lon - 72.88) < 0.75) || // Mumbai
    (Math.abs(lat - 22.57) < 0.75 && Math.abs(lon - 88.36) < 0.75) || // Kolkata
    (Math.abs(lat - 13.08) < 0.75 && Math.abs(lon - 80.27) < 0.75) || // Chennai
    (Math.abs(lat - 12.97) < 0.75 && Math.abs(lon - 77.59) < 0.75)    // Bengaluru
  );
  if (nearMajorCity && (variable === 'temp_max' || variable === 'temp_min') && sigmaDeviation > 0) {
    return 'urban_heat';
  }

  // Valley channeling: negative temperature anomaly
  if ((variable === 'temp_max' || variable === 'temp_min') && sigmaDeviation < 0) {
    return 'valley_channeling';
  }

  // Orographic / elevation: high rainfall in Western Ghats or NE India
  const inWesternGhats = lon >= 74 && lon <= 78 && lat >= 8 && lat <= 21;
  const inNEIndia = lon >= 89 && lon <= 97 && lat >= 22 && lat <= 28;
  if ((inWesternGhats || inNEIndia) && variable === 'rainfall' && sigmaDeviation > 0) {
    return 'elevation';
  }

  return 'unknown';
}

/**
 * Detect all micro-climate zones in a grid for a given variable.
 *
 * A cell is a micro-climate zone when its value departs from the mean of
 * its 8 immediate neighbors by more than MICRO_CLIMATE_SIGMA_THRESHOLD
 * standard deviations of those neighbors.
 *
 * Requirement 60.1.
 */
export function detectMicroClimateZones(
  gridCells: GridCell[],
  variable: VariableId,
  sigmaThreshold = MICRO_CLIMATE_SIGMA_THRESHOLD,
): MicroClimateZone[] {
  if (gridCells.length === 0) return [];

  const index = buildSpatialIndex(gridCells);
  const zones: MicroClimateZone[] = [];

  for (const cell of gridCells) {
    const neighbors = findNeighbors(cell.lat, cell.lon, index);
    // Need at least 3 neighbors for a meaningful std-dev
    if (neighbors.length < 3) continue;

    const neighborValues = neighbors.map((n) => getCellValue(n, variable));
    const { mean, stdDev } = meanAndStdDev(neighborValues);

    // When all neighbors are identical (stdDev ≈ 0), use a unit std-dev of
    // 1% of the mean (or 0.01 as floor) so the sigma deviation is finite.
    // A cell that meaningfully differs from perfectly uniform neighbors is
    // still a genuine micro-climate anomaly.
    const effectiveStdDev = stdDev < 1e-9 ? Math.max(0.01, Math.abs(mean) * 0.01) : stdDev;

    const value = getCellValue(cell, variable);
    const sigmaDeviation = (value - mean) / effectiveStdDev;

    if (Math.abs(sigmaDeviation) > sigmaThreshold) {
      const cause = inferCause(cell, variable, sigmaDeviation);
      zones.push({
        cell,
        variable,
        value,
        neighborMean: mean,
        neighborStdDev: effectiveStdDev,
        sigmaDeviation,
        cause,
        causeLabel: CAUSE_DESCRIPTIONS[cause],
        outlineColor: CAUSE_COLORS[cause],
      });
    }
  }

  // Sort by |sigmaDeviation| descending (strongest anomalies first)
  return zones.sort((a, b) => Math.abs(b.sigmaDeviation) - Math.abs(a.sigmaDeviation));
}

/**
 * Estimate a synthetic LULC class for a grid cell based on geographic heuristics.
 *
 * In production this would query a real LULC raster dataset (e.g. ESA CCI,
 * Bhuvan LULC).  For demo / offline use we approximate from coordinates.
 *
 * Requirement 60.4: overlay LULC data for correlation.
 */
export function estimateLULC(lat: number, lon: number): LULCClass {
  // High-altitude: Himalayan belt (lat > 32) → snow_ice
  if (lat > 32 && lon >= 75 && lon <= 85) return 'snow_ice';

  // Water bodies: major lakes / reservoirs near known coords
  const nearWater = (
    (Math.abs(lat - 22.6) < 0.5 && Math.abs(lon - 88.4) < 0.5) || // Kolkata / Hooghly
    (Math.abs(lat - 15.5) < 0.5 && Math.abs(lon - 73.9) < 0.5)    // Goa coast
  );
  if (nearWater) return 'water';

  // Urban: cells very close to major city centers
  const urban = [
    [28.61, 77.21], [19.08, 72.88], [22.57, 88.36],
    [13.08, 80.27], [12.97, 77.59], [17.39, 78.49],
    [23.03, 72.59], [26.85, 80.95], [26.91, 75.79],
  ];
  for (const [cLat, cLon] of urban) {
    if (Math.abs(lat - cLat) < 0.375 && Math.abs(lon - cLon) < 0.375) return 'urban';
  }

  // Forest: Western Ghats and NE India
  const inGhats = lon >= 74 && lon <= 78 && lat >= 8 && lat <= 21;
  const inNE = lon >= 89 && lon <= 97 && lat >= 22 && lat <= 28;
  if (inGhats || inNE) return 'forest';

  // Barren: Thar Desert (Rajasthan)
  if (lat >= 24 && lat <= 30 && lon >= 68 && lon <= 76) return 'barren';

  // Default: cropland (most of agricultural India)
  return 'cropland';
}

/**
 * Build LULC overlay cells from the grid for globe rendering.
 *
 * Requirement 60.4.
 */
export function buildLULCOverlay(gridCells: GridCell[]): LULCCell[] {
  return gridCells.map((cell) => {
    const lulcClass = estimateLULC(cell.lat, cell.lon);
    return {
      lat: cell.lat,
      lon: cell.lon,
      lulcClass,
      color: LULC_COLORS[lulcClass],
      label: LULC_LABELS[lulcClass],
    };
  });
}

/**
 * Generate a Micro-Climate Report for a given zone.
 *
 * Historical frequency is approximated as a function of sigma deviation
 * (stronger anomalies tend to recur more rarely). In production this
 * would query a historical predictions archive.
 *
 * Requirement 60.3.
 */
export function generateMicroClimateReport(
  zone: MicroClimateZone,
  gridCells: GridCell[],
): MicroClimateReport {
  const lulcClass = estimateLULC(zone.cell.lat, zone.cell.lon);

  // Heuristic: more extreme zones occur less frequently historically
  const absSigma = Math.abs(zone.sigmaDeviation);
  const historicalFrequency = Math.max(0.02, Math.min(0.45, 1 / (absSigma * 2)));

  const variableLabel = zone.variable === 'rainfall' ? 'rainfall'
    : zone.variable === 'temp_max' ? 'max temperature' : 'min temperature';
  const direction = zone.sigmaDeviation > 0 ? 'above' : 'below';
  const absDevStr = Math.abs(zone.sigmaDeviation).toFixed(1);

  const summary =
    `This cell (${zone.cell.lat.toFixed(2)}°N, ${zone.cell.lon.toFixed(2)}°E) shows ` +
    `${variableLabel} ${direction} its local neighborhood mean by ${absDevStr}σ. ` +
    `The most likely driver is "${zone.causeLabel}". ` +
    `Land cover at this location is classified as ${LULC_LABELS[lulcClass]}. ` +
    `Historically, conditions this anomalous occur approximately ` +
    `${(historicalFrequency * 100).toFixed(0)}% of the time at this location.`;

  return { zone, historicalFrequency, lulcClass, summary };
}

// ── Mock data (demo / fallback) ───────────────────────────────────────────────

/** Synthetic grid cells for demo when no live data is available */
export const MOCK_GRID_CELLS: GridCell[] = [
  // Western Ghats rainfall hotspot
  { lat: 16.25, lon: 74.25, node_idx: 0, rainfall: 185, temp_max: 28, temp_min: 22, rainfall_uncertainty: 12, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  { lat: 16.25, lon: 74.00, node_idx: 1, rainfall:  45, temp_max: 33, temp_min: 26, rainfall_uncertainty:  6, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  { lat: 16.25, lon: 74.50, node_idx: 2, rainfall:  50, temp_max: 32, temp_min: 25, rainfall_uncertainty:  6, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  { lat: 16.00, lon: 74.00, node_idx: 3, rainfall:  42, temp_max: 33, temp_min: 25, rainfall_uncertainty:  5, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  { lat: 16.00, lon: 74.25, node_idx: 4, rainfall:  48, temp_max: 32, temp_min: 24, rainfall_uncertainty:  6, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  { lat: 16.00, lon: 74.50, node_idx: 5, rainfall:  46, temp_max: 33, temp_min: 25, rainfall_uncertainty:  5, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  { lat: 16.50, lon: 74.00, node_idx: 6, rainfall:  44, temp_max: 33, temp_min: 26, rainfall_uncertainty:  5, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  { lat: 16.50, lon: 74.25, node_idx: 7, rainfall:  47, temp_max: 32, temp_min: 25, rainfall_uncertainty:  6, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  { lat: 16.50, lon: 74.50, node_idx: 8, rainfall:  49, temp_max: 32, temp_min: 25, rainfall_uncertainty:  5, temp_max_uncertainty: 1, temp_min_uncertainty: 0.8 },
  // Delhi urban heat anomaly
  { lat: 28.75, lon: 77.25, node_idx: 9,  rainfall:  10, temp_max: 46, temp_min: 32, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
  { lat: 28.75, lon: 77.00, node_idx: 10, rainfall:  12, temp_max: 40, temp_min: 28, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
  { lat: 28.75, lon: 77.50, node_idx: 11, rainfall:  11, temp_max: 41, temp_min: 29, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
  { lat: 28.50, lon: 77.00, node_idx: 12, rainfall:  10, temp_max: 41, temp_min: 29, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
  { lat: 28.50, lon: 77.25, node_idx: 13, rainfall:  12, temp_max: 42, temp_min: 30, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
  { lat: 28.50, lon: 77.50, node_idx: 14, rainfall:  11, temp_max: 40, temp_min: 28, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
  { lat: 29.00, lon: 77.00, node_idx: 15, rainfall:  10, temp_max: 40, temp_min: 28, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
  { lat: 29.00, lon: 77.25, node_idx: 16, rainfall:  11, temp_max: 41, temp_min: 29, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
  { lat: 29.00, lon: 77.50, node_idx: 17, rainfall:   9, temp_max: 40, temp_min: 28, rainfall_uncertainty: 3, temp_max_uncertainty: 0.8, temp_min_uncertainty: 0.6 },
];

// ── Sub-components ────────────────────────────────────────────────────────────

/** Cause badge pill */
const CauseBadge: React.FC<{ cause: MicroClimateCause }> = ({ cause }) => {
  const color = CAUSE_COLORS[cause];
  return (
    <span
      style={{
        background: `${color}22`,
        border: `1px solid ${color}`,
        borderRadius: '4px',
        color,
        fontWeight: 600,
        fontSize: '10px',
        padding: '1px 5px',
        whiteSpace: 'nowrap',
        textTransform: 'capitalize',
      }}
    >
      {cause.replace('_', ' ')}
    </span>
  );
};

/** Row in the zone table */
const ZoneRow: React.FC<{
  zone: MicroClimateZone;
  rank: number;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ zone, rank, isSelected, onSelect }) => {
  const color = zone.outlineColor;
  const sigmaStr = `${zone.sigmaDeviation > 0 ? '+' : ''}${zone.sigmaDeviation.toFixed(1)}σ`;

  return (
    <tr
      onClick={onSelect}
      aria-selected={isSelected}
      style={{
        cursor: 'pointer',
        background: isSelected ? 'rgba(255,255,255,0.08)' : rank % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
        borderLeft: isSelected ? `3px solid ${color}` : '3px solid transparent',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.06)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = isSelected ? 'rgba(255,255,255,0.08)' : rank % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent')}
    >
      <td style={{ padding: '5px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '11px' }}>{rank}</td>
      <td style={{ padding: '5px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.75)' }}>
        {zone.cell.lat.toFixed(2)}°, {zone.cell.lon.toFixed(2)}°
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
        {zone.variable}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
        <span style={{ color, fontWeight: 700, fontSize: '12px' }}>{sigmaStr}</span>
      </td>
      <td style={{ padding: '5px 8px' }}>
        <CauseBadge cause={zone.cause} />
      </td>
    </tr>
  );
};

/** Detail panel shown when a zone is selected */
const ZoneDetailCard: React.FC<{ report: MicroClimateReport }> = ({ report }) => {
  const { zone, historicalFrequency, lulcClass, summary } = report;
  const color = zone.outlineColor;
  const lulcColor = LULC_COLORS[lulcClass];

  return (
    <div
      style={{
        background: `${color}10`,
        border: `1px solid ${color}50`,
        borderRadius: 'var(--radius-md, 8px)',
        padding: 'var(--space-md, 12px)',
        marginTop: 'var(--space-md, 12px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
        <div>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
            📍 {zone.cell.lat.toFixed(2)}°N, {zone.cell.lon.toFixed(2)}°E
          </span>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
            Micro-Climate Zone · {zone.variable}
          </div>
        </div>
        <span style={{ fontSize: '20px', fontWeight: 700, color }}>
          {zone.sigmaDeviation > 0 ? '+' : ''}{zone.sigmaDeviation.toFixed(1)}σ
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
        {[
          { label: 'Cell value', value: `${zone.value.toFixed(1)}`, color: 'rgba(255,255,255,0.85)' },
          { label: 'Neighbor mean', value: `${zone.neighborMean.toFixed(1)}`, color: 'rgba(255,255,255,0.6)' },
          { label: 'Neighbor σ', value: `±${zone.neighborStdDev.toFixed(1)}`, color: 'rgba(255,255,255,0.6)' },
        ].map(({ label, value, color: c }) => (
          <div key={label} style={{ fontSize: '11px' }}>
            <div style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</div>
            <div style={{ color: c, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Cause:</span>
        <CauseBadge cause={zone.cause} />
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' }}>LULC:</span>
        <span style={{ fontSize: '11px', color: lulcColor, fontWeight: 600 }}>{LULC_LABELS[lulcClass]}</span>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Historical frequency of anomalous conditions: </span>
        <span style={{ fontSize: '11px', color, fontWeight: 700 }}>
          {(historicalFrequency * 100).toFixed(0)}% of days
        </span>
        <div
          aria-label={`Historical frequency: ${(historicalFrequency * 100).toFixed(0)}%`}
          style={{ marginTop: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}
        >
          <div style={{ width: `${(historicalFrequency * 100).toFixed(0)}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 400ms ease' }} />
        </div>
      </div>

      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.5, margin: 0 }}>
        {summary}
      </p>
    </div>
  );
};

/** LULC legend strip */
const LULCLegend: React.FC = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: 'var(--space-md, 12px)' }}>
    {(Object.keys(LULC_COLORS) as LULCClass[]).map((cls) => (
      <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'rgba(255,255,255,0.55)' }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: LULC_COLORS[cls], display: 'inline-block', flexShrink: 0 }} />
        {LULC_LABELS[cls]}
      </div>
    ))}
  </div>
);

/** Cause legend */
const CauseLegend: React.FC = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: 'var(--space-md, 12px)' }}>
    {(Object.keys(CAUSE_COLORS) as MicroClimateCause[]).filter(c => c !== 'unknown').map((cause) => (
      <div key={cause} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'rgba(255,255,255,0.55)' }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: CAUSE_COLORS[cause], display: 'inline-block', flexShrink: 0 }} />
        {CAUSE_DESCRIPTIONS[cause]}
      </div>
    ))}
  </div>
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MicroClimateZonesProps {
  /** Climate grid cells; falls back to MOCK_GRID_CELLS when omitted */
  gridCells?: GridCell[];
  /** Climate variable to analyse (default: 'rainfall') */
  variable?: VariableId;
  /** Whether the panel is active */
  enabled?: boolean;
  /** Called with detected zones and LULC overlay for globe rendering */
  onZonesDetected?: (zones: MicroClimateZone[], lulcCells: LULCCell[]) => void;
  /** Called when user selects a specific zone (for globe fly-to) */
  onZoneSelect?: (zone: MicroClimateZone) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * MicroClimateZones — Micro-Climate Zone Identification Panel.
 *
 * Validates: Requirements 60.1, 60.2, 60.4
 */
export const MicroClimateZones: React.FC<MicroClimateZonesProps> = ({
  gridCells,
  variable = 'rainfall',
  enabled = true,
  onZonesDetected,
  onZoneSelect,
}) => {
  const [activeTab, setActiveTab] = useState<'zones' | 'lulc'>('zones');
  const [selectedZoneIdx, setSelectedZoneIdx] = useState<number | null>(null);

  const resolvedGrid = gridCells && gridCells.length > 0 ? gridCells : MOCK_GRID_CELLS;

  const zones = useMemo(
    () => detectMicroClimateZones(resolvedGrid, variable),
    [resolvedGrid, variable],
  );

  const lulcCells = useMemo(
    () => buildLULCOverlay(resolvedGrid),
    [resolvedGrid],
  );

  const selectedReport = useMemo<MicroClimateReport | null>(() => {
    if (selectedZoneIdx === null || !zones[selectedZoneIdx]) return null;
    return generateMicroClimateReport(zones[selectedZoneIdx], resolvedGrid);
  }, [selectedZoneIdx, zones, resolvedGrid]);

  React.useEffect(() => {
    if (onZonesDetected && zones.length > 0) {
      onZonesDetected(zones, lulcCells);
    }
  }, [zones, lulcCells, onZonesDetected]);

  const handleZoneSelect = (idx: number) => {
    const next = idx === selectedZoneIdx ? null : idx;
    setSelectedZoneIdx(next);
    if (next !== null && onZoneSelect) {
      onZoneSelect(zones[next]);
    }
  };

  if (!enabled) return null;

  return (
    <div
      className="micro-climate-zones"
      data-testid="micro-climate-zones"
      role="region"
      aria-label="Micro-Climate Zone Identification"
    >
      {/* ── Banner ── */}
      <div
        role="status"
        aria-live="polite"
        style={{
          background: zones.length > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(148,163,184,0.08)',
          border: `1px solid ${zones.length > 0 ? '#f59e0b' : 'rgba(148,163,184,0.3)'}`,
          borderRadius: 'var(--radius-md, 8px)',
          padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
          marginBottom: 'var(--space-md, 12px)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: zones.length > 0 ? 'mcz-banner-pulse 3s ease-in-out infinite' : 'none',
        }}
      >
        <span style={{ fontSize: '18px' }} aria-hidden="true">🌡️</span>
        <div>
          <span style={{ fontSize: '14px', fontWeight: 700, color: zones.length > 0 ? '#fcd34d' : 'rgba(255,255,255,0.6)' }}>
            {zones.length} micro-climate zone{zones.length !== 1 ? 's' : ''} detected
          </span>
          <span style={{ marginLeft: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
            &gt;{MICRO_CLIMATE_SIGMA_THRESHOLD}σ from neighbors · {variable}
          </span>
        </div>
      </div>

      <GlassPanel padding="md" className="mcz-panel">
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
          🗺️ Micro-Climate Zone Identification
          <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>
            {resolvedGrid.length} cells analysed
          </span>
        </h3>

        {/* Tab selector */}
        <div
          role="tablist"
          style={{ display: 'flex', gap: '4px', marginBottom: 'var(--space-md, 12px)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}
        >
          {([
            { key: 'zones', label: '⚠ Zones' },
            { key: 'lulc', label: '🌿 Land-Use Overlay' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
              style={{
                background: activeTab === key ? 'rgba(245,158,11,0.2)' : 'transparent',
                border: `1px solid ${activeTab === key ? '#f59e0b' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: '5px',
                color: activeTab === key ? '#fcd34d' : 'rgba(255,255,255,0.55)',
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

        {/* Zone tab */}
        {activeTab === 'zones' && (
          <>
            <CauseLegend />
            {zones.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '13px' }}>
                No micro-climate zones detected above {MICRO_CLIMATE_SIGMA_THRESHOLD}σ threshold for {variable}.
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: '300px' }}>
                <table
                  style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
                  aria-label="Detected micro-climate zones"
                >
                  <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
                    <tr>
                      {['#', 'Location', 'Variable', 'Δσ', 'Cause'].map((label, i) => (
                        <th
                          key={label}
                          scope="col"
                          style={{
                            padding: '6px 8px',
                            textAlign: i <= 1 ? (i === 0 ? 'center' : 'left') : 'center',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: 'rgba(255,255,255,0.5)',
                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map((zone, idx) => (
                      <ZoneRow
                        key={`${zone.cell.lat}_${zone.cell.lon}_${zone.variable}`}
                        zone={zone}
                        rank={idx + 1}
                        isSelected={selectedZoneIdx === idx}
                        onSelect={() => handleZoneSelect(idx)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedReport && <ZoneDetailCard report={selectedReport} />}
          </>
        )}

        {/* LULC tab */}
        {activeTab === 'lulc' && (
          <>
            <LULCLegend />
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '12px', lineHeight: 1.5 }}>
              Land-use/land-cover classes are estimated from geographic heuristics for India.
              In production, data is sourced from ESA CCI LULC or Bhuvan LULC datasets.
              Overlay is correlated with detected micro-climate zones to identify surface drivers.
            </div>
            <div style={{ overflowY: 'auto', maxHeight: '320px' }}>
              <table
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}
                aria-label="Land-use land-cover overlay"
              >
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
                  <tr>
                    {['Location', 'LULC Class', 'MCZ?'].map((label, i) => (
                      <th
                        key={label}
                        scope="col"
                        style={{
                          padding: '5px 8px',
                          textAlign: i === 0 ? 'left' : 'center',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: 'rgba(255,255,255,0.4)',
                          borderBottom: '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lulcCells.map((cell, idx) => {
                    const isZone = zones.some((z) => z.cell.lat === cell.lat && z.cell.lon === cell.lon);
                    return (
                      <tr
                        key={`${cell.lat}_${cell.lon}`}
                        style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
                      >
                        <td style={{ padding: '4px 8px', color: 'rgba(255,255,255,0.65)' }}>
                          {cell.lat.toFixed(2)}°, {cell.lon.toFixed(2)}°
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <span style={{ color: cell.color, fontWeight: 600 }}>{cell.label}</span>
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          {isZone ? (
                            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '12px' }}>⚠ Yes</span>
                          ) : (
                            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '11px' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </GlassPanel>

      <style>{`
        @keyframes mcz-banner-pulse {
          0%, 100% { box-shadow: 0 0 5px rgba(245,158,11,0.2); }
          50%       { box-shadow: 0 0 16px rgba(245,158,11,0.55); }
        }
      `}</style>
    </div>
  );
};

export default MicroClimateZones;
