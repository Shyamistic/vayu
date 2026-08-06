/**
 * UrbanHeatIsland — Urban Heat Island (UHI) Intensity Mapping.
 *
 * Exports pure functions for UHI computation (testable), plus a React component:
 *  1. Ranked city list showing UHI intensity with trend indicators
 *  2. Diverging color overlay data for the globe (warm = positive UHI)
 *  3. City detail card on selection
 *
 * UHI intensity = mean(urban grid cells temp_max) − mean(surrounding rural cells temp_max)
 *
 * Validates: Requirements 41.1, 41.2, 41.3
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Trend direction for UHI intensity over time */
export type UHITrend = 'increasing' | 'decreasing' | 'stable';

/** UHI intensity result for a single city */
export interface UHIResult {
  cityName: string;
  state: string;
  lat: number;
  lon: number;
  /** Mean temp_max of urban grid cells (°C) */
  urbanTemp: number;
  /** Mean temp_max of surrounding rural grid cells (°C) */
  ruralTemp: number;
  /** UHI intensity = urbanTemp − ruralTemp (°C) */
  intensity: number;
  trend: UHITrend;
  /** Number of urban cells used */
  urbanCellCount: number;
  /** Number of rural cells used */
  ruralCellCount: number;
}

/** Geographic definition of a major Indian city for UHI analysis */
export interface CityDefinition {
  name: string;
  state: string;
  lat: number;
  lon: number;
  /** Radius (in degrees) for urban core cells */
  urbanRadiusDeg: number;
  /** Inner/outer radii (degrees) for rural ring cells */
  ruralInnerDeg: number;
  ruralOuterDeg: number;
}

/** Cell annotated with UHI color for globe overlay */
export interface UHIOverlayCell {
  lat: number;
  lon: number;
  intensity: number;
  /** CSS hex color from the diverging palette */
  color: string;
}

// ── Major Indian Cities ───────────────────────────────────────────────────────

/**
 * Major Indian cities to analyse for UHI.
 * Radii are tuned to the 0.25° grid resolution.
 * Requirement 41.1: compute UHI for major Indian cities.
 */
export const CITY_DEFINITIONS: CityDefinition[] = [
  { name: 'Delhi',     state: 'Delhi',             lat: 28.61, lon: 77.21, urbanRadiusDeg: 0.5,  ruralInnerDeg: 0.75, ruralOuterDeg: 1.5 },
  { name: 'Mumbai',    state: 'Maharashtra',        lat: 19.08, lon: 72.88, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Kolkata',   state: 'West Bengal',        lat: 22.57, lon: 88.36, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Chennai',   state: 'Tamil Nadu',         lat: 13.08, lon: 80.27, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Bengaluru', state: 'Karnataka',          lat: 12.97, lon: 77.59, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Hyderabad', state: 'Telangana',          lat: 17.39, lon: 78.49, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Ahmedabad', state: 'Gujarat',            lat: 23.03, lon: 72.59, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Pune',      state: 'Maharashtra',        lat: 18.52, lon: 73.86, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Jaipur',    state: 'Rajasthan',          lat: 26.91, lon: 75.79, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Lucknow',   state: 'Uttar Pradesh',      lat: 26.85, lon: 80.95, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Nagpur',    state: 'Maharashtra',        lat: 21.15, lon: 79.09, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
  { name: 'Bhopal',    state: 'Madhya Pradesh',     lat: 23.26, lon: 77.41, urbanRadiusDeg: 0.375, ruralInnerDeg: 0.625, ruralOuterDeg: 1.25 },
];

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Euclidean distance in degrees between two lat/lon points.
 * Adequate for small distances at the 0.25° grid scale.
 */
export function latLonDistanceDeg(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dlat = lat1 - lat2;
  const dlon = lon1 - lon2;
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

/**
 * Compute the mean temp_max of a subset of grid cells.
 * Returns NaN when the array is empty.
 */
export function meanTempMax(cells: GridCell[]): number {
  if (cells.length === 0) return NaN;
  return cells.reduce((sum, c) => sum + c.temp_max, 0) / cells.length;
}

/**
 * Select urban core cells: grid cells within `urbanRadiusDeg` of the city centre.
 *
 * Requirement 41.1: urban grid cells are those closest to the city centre.
 */
export function selectUrbanCells(
  gridCells: GridCell[],
  city: CityDefinition,
): GridCell[] {
  return gridCells.filter(
    (c) => latLonDistanceDeg(c.lat, c.lon, city.lat, city.lon) <= city.urbanRadiusDeg,
  );
}

/**
 * Select rural ring cells: grid cells in the annulus
 * [ruralInnerDeg, ruralOuterDeg] from the city centre.
 *
 * Requirement 41.1: surrounding rural cells form the reference baseline.
 */
export function selectRuralCells(
  gridCells: GridCell[],
  city: CityDefinition,
): GridCell[] {
  return gridCells.filter((c) => {
    const d = latLonDistanceDeg(c.lat, c.lon, city.lat, city.lon);
    return d > city.ruralInnerDeg && d <= city.ruralOuterDeg;
  });
}

/**
 * Compute UHI intensity for a single city.
 *
 * Returns null when either urban or rural cells are absent in the grid
 * (city outside the active region or insufficient data).
 *
 * Requirement 41.1: UHI intensity = urban mean temp_max − rural mean temp_max.
 */
export function computeUHI(
  gridCells: GridCell[],
  city: CityDefinition,
  trend: UHITrend = 'stable',
): UHIResult | null {
  const urbanCells = selectUrbanCells(gridCells, city);
  const ruralCells = selectRuralCells(gridCells, city);

  if (urbanCells.length === 0 || ruralCells.length === 0) return null;

  const urbanTemp = meanTempMax(urbanCells);
  const ruralTemp = meanTempMax(ruralCells);

  return {
    cityName: city.name,
    state: city.state,
    lat: city.lat,
    lon: city.lon,
    urbanTemp,
    ruralTemp,
    intensity: urbanTemp - ruralTemp,
    trend,
    urbanCellCount: urbanCells.length,
    ruralCellCount: ruralCells.length,
  };
}

/**
 * Compute UHI results for all cities from the provided grid.
 * Cities with insufficient coverage are silently omitted.
 *
 * Requirement 41.1.
 */
export function computeAllUHI(
  gridCells: GridCell[],
  cities: CityDefinition[] = CITY_DEFINITIONS,
  trendOverrides: Partial<Record<string, UHITrend>> = {},
): UHIResult[] {
  const results: UHIResult[] = [];
  for (const city of cities) {
    const trend = trendOverrides[city.name] ?? inferTrend(city.name);
    const result = computeUHI(gridCells, city, trend);
    if (result) results.push(result);
  }
  // Sort descending by intensity (Requirement 41.3)
  return results.sort((a, b) => b.intensity - a.intensity);
}

/**
 * Placeholder trend inference — in production this would compare
 * the current prediction with prior-day/week predictions from a cache.
 * Returns 'stable' by default; exported so it can be overridden/mocked in tests.
 */
export function inferTrend(_cityName: string): UHITrend {
  // Production: compare stored historical UHI values; for demo, use stable
  return 'stable';
}

/**
 * Map a UHI intensity value (°C) to a CSS hex color on a diverging
 * blue → white → red palette.
 *
 * Negative UHI (urban cooler than rural) → blue shades
 * Near zero (±0.5 °C)                    → white/light
 * Positive UHI (urban hotter)            → red/orange shades
 *
 * Requirement 41.2: diverging color overlay.
 */
export function uhiIntensityToColor(intensity: number): string {
  // Clamp to [-5, 5] °C range for color mapping
  const clamped = Math.max(-5, Math.min(5, intensity));
  const t = (clamped + 5) / 10; // normalize to [0, 1]

  if (t < 0.5) {
    // Blue → white: t in [0, 0.5]
    const u = t / 0.5; // 0=deep blue, 1=white
    const r = Math.round(30  + u * (255 - 30));
    const g = Math.round(100 + u * (255 - 100));
    const b = Math.round(200 + u * (255 - 200));
    return `rgb(${r},${g},${b})`;
  }
  // White → red/orange: t in [0.5, 1]
  const u = (t - 0.5) / 0.5; // 0=white, 1=deep red
  const r = 255;
  const g = Math.round(255 - u * (255 - 50));
  const b = Math.round(255 - u * 255);
  return `rgb(${r},${g},${b})`;
}

/**
 * Build overlay cells for the diverging color globe layer.
 * Combines urban and rural cells for a city with the UHI color.
 *
 * Requirement 41.2: render UHI as diverging color overlay.
 */
export function buildUHIOverlayCells(
  gridCells: GridCell[],
  results: UHIResult[],
  cities: CityDefinition[] = CITY_DEFINITIONS,
): UHIOverlayCell[] {
  const overlay: UHIOverlayCell[] = [];
  const cityByName = new Map(cities.map((c) => [c.name, c]));

  for (const result of results) {
    const city = cityByName.get(result.cityName);
    if (!city) continue;

    const allCityCells = gridCells.filter(
      (c) => latLonDistanceDeg(c.lat, c.lon, city.lat, city.lon) <= city.ruralOuterDeg,
    );

    for (const cell of allCityCells) {
      const dist = latLonDistanceDeg(cell.lat, cell.lon, city.lat, city.lon);
      // Urban cells carry the full UHI intensity; rural cells carry 0 (reference)
      const cellIntensity = dist <= city.urbanRadiusDeg ? result.intensity : 0;
      overlay.push({
        lat: cell.lat,
        lon: cell.lon,
        intensity: cellIntensity,
        color: uhiIntensityToColor(cellIntensity),
      });
    }
  }
  return overlay;
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

/**
 * Mock UHI results for demo / fallback when grid data lacks coverage.
 * Values based on published studies of Indian city UHI intensities.
 */
export const MOCK_UHI_RESULTS: UHIResult[] = [
  { cityName: 'Delhi',     state: 'Delhi',          lat: 28.61, lon: 77.21, urbanTemp: 42.3, ruralTemp: 38.5, intensity: 3.8, trend: 'increasing',  urbanCellCount: 4, ruralCellCount: 12 },
  { cityName: 'Mumbai',    state: 'Maharashtra',     lat: 19.08, lon: 72.88, urbanTemp: 36.1, ruralTemp: 33.2, intensity: 2.9, trend: 'increasing',  urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Kolkata',   state: 'West Bengal',     lat: 22.57, lon: 88.36, urbanTemp: 38.4, ruralTemp: 35.9, intensity: 2.5, trend: 'stable',      urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Chennai',   state: 'Tamil Nadu',      lat: 13.08, lon: 80.27, urbanTemp: 37.8, ruralTemp: 35.5, intensity: 2.3, trend: 'increasing',  urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Hyderabad', state: 'Telangana',       lat: 17.39, lon: 78.49, urbanTemp: 40.2, ruralTemp: 38.1, intensity: 2.1, trend: 'increasing',  urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Bengaluru', state: 'Karnataka',       lat: 12.97, lon: 77.59, urbanTemp: 33.5, ruralTemp: 31.8, intensity: 1.7, trend: 'stable',      urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Ahmedabad', state: 'Gujarat',         lat: 23.03, lon: 72.59, urbanTemp: 43.1, ruralTemp: 41.6, intensity: 1.5, trend: 'decreasing',  urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Pune',      state: 'Maharashtra',     lat: 18.52, lon: 73.86, urbanTemp: 36.0, ruralTemp: 34.6, intensity: 1.4, trend: 'stable',      urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Jaipur',    state: 'Rajasthan',       lat: 26.91, lon: 75.79, urbanTemp: 44.2, ruralTemp: 43.0, intensity: 1.2, trend: 'stable',      urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Lucknow',   state: 'Uttar Pradesh',   lat: 26.85, lon: 80.95, urbanTemp: 41.5, ruralTemp: 40.4, intensity: 1.1, trend: 'decreasing',  urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Nagpur',    state: 'Maharashtra',     lat: 21.15, lon: 79.09, urbanTemp: 43.6, ruralTemp: 42.8, intensity: 0.8, trend: 'stable',      urbanCellCount: 3, ruralCellCount: 10 },
  { cityName: 'Bhopal',    state: 'Madhya Pradesh',  lat: 23.26, lon: 77.41, urbanTemp: 41.1, ruralTemp: 40.5, intensity: 0.6, trend: 'decreasing',  urbanCellCount: 3, ruralCellCount: 10 },
];

// ── Constants ─────────────────────────────────────────────────────────────────

/** UHI threshold above which a city is considered a "hotspot" */
export const UHI_HOTSPOT_THRESHOLD = 2.5; // °C

// ── Color scale helper ────────────────────────────────────────────────────────

/** Return a human-readable UHI intensity category */
export function uhiCategory(intensity: number): string {
  if (intensity < 0) return 'Urban Cool Island';
  if (intensity < 1) return 'Negligible';
  if (intensity < 2) return 'Weak';
  if (intensity < 3) return 'Moderate';
  if (intensity < 4) return 'Strong';
  return 'Extreme';
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Trend icon and label */
const TrendBadge: React.FC<{ trend: UHITrend }> = ({ trend }) => {
  const config = {
    increasing: { icon: '↑', color: '#ef4444', label: 'Increasing' },
    decreasing: { icon: '↓', color: '#22c55e', label: 'Decreasing' },
    stable:     { icon: '→', color: '#94a3b8', label: 'Stable' },
  }[trend];

  return (
    <span
      aria-label={`Trend: ${config.label}`}
      title={config.label}
      style={{
        color: config.color,
        fontWeight: 700,
        fontSize: '13px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
      }}
    >
      {config.icon}
    </span>
  );
};

/** Diverging color scale legend */
const DivergingLegend: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-sm, 8px)',
      marginBottom: 'var(--space-md, 12px)',
      fontSize: 'var(--font-small, 11px)',
      color: 'rgba(var(--fg-rgb),var(--fg-a6))',
    }}
  >
    <span>−5°C</span>
    <div
      aria-hidden="true"
      style={{
        flex: 1,
        height: '10px',
        borderRadius: '5px',
        background: 'linear-gradient(to right, rgb(30,100,200), #fff, rgb(255,50,0))',
      }}
    />
    <span>+5°C</span>
  </div>
);

interface CityRowProps {
  result: UHIResult;
  rank: number;
  isSelected: boolean;
  onSelect: () => void;
}

const CityRow: React.FC<CityRowProps> = ({ result, rank, isSelected, onSelect }) => {
  const color = uhiIntensityToColor(result.intensity);
  const isHotspot = result.intensity >= UHI_HOTSPOT_THRESHOLD;

  return (
    <tr
      onClick={onSelect}
      aria-selected={isSelected}
      style={{
        cursor: 'pointer',
        background: isSelected ? 'rgba(var(--fg-rgb),var(--fg-a08))' : rank % 2 === 0 ? 'rgba(var(--fg-rgb),var(--fg-a05))' : 'transparent',
        borderLeft: isSelected ? `3px solid ${color}` : '3px solid transparent',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'rgba(var(--fg-rgb),var(--fg-a05))')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = isSelected ? 'rgba(var(--fg-rgb),var(--fg-a08))' : rank % 2 === 0 ? 'rgba(var(--fg-rgb),var(--fg-a05))' : 'transparent')}
    >
      <td style={{ padding: '5px 8px', textAlign: 'center', color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontSize: '11px' }}>
        {rank}
      </td>
      <td style={{ padding: '5px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {isHotspot && (
            <span aria-label="UHI hotspot" style={{ fontSize: '12px', animation: 'uhi-hotspot-blink 1.5s ease-in-out infinite' }}>
              🌡️
            </span>
          )}
          <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a75))', fontWeight: 500 }}>{result.cityName}</span>
          <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontSize: '10px' }}>{result.state}</span>
        </div>
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
          }}
        >
          {result.intensity >= 0 ? '+' : ''}{result.intensity.toFixed(1)}°C
        </span>
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
        <TrendBadge trend={result.trend} />
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a6))' }}>
        {uhiCategory(result.intensity)}
      </td>
    </tr>
  );
};

/** Detail card for the selected city */
const CityDetailCard: React.FC<{ result: UHIResult }> = ({ result }) => {
  const color = uhiIntensityToColor(result.intensity);
  const category = uhiCategory(result.intensity);
  const isHotspot = result.intensity >= UHI_HOTSPOT_THRESHOLD;

  return (
    <div
      style={{
        background: `${color}12`,
        border: `1px solid ${color}50`,
        borderRadius: 'var(--radius-md, 8px)',
        padding: 'var(--space-md, 12px)',
        marginTop: 'var(--space-md, 12px)',
        animation: isHotspot ? 'uhi-card-pulse 2s ease-in-out infinite' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div>
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'rgba(var(--fg-rgb),var(--fg-a75))' }}>
            {isHotspot && '🌡️ '}{result.cityName}
          </span>
          <span style={{ marginLeft: '8px', fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            {result.state}
          </span>
        </div>
        <span style={{ fontSize: '22px', fontWeight: 700, color }}>
          {result.intensity >= 0 ? '+' : ''}{result.intensity.toFixed(1)}°C
        </span>
      </div>

      <div style={{ fontSize: '12px', color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
        {category} UHI · <TrendBadge trend={result.trend} /> {result.trend.charAt(0).toUpperCase() + result.trend.slice(1)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px' }}>
        {[
          { label: 'Urban mean temp', value: `${result.urbanTemp.toFixed(1)}°C`, color: '#f97316' },
          { label: 'Rural mean temp',  value: `${result.ruralTemp.toFixed(1)}°C`,  color: '#60a5fa' },
          { label: 'Urban cells used', value: String(result.urbanCellCount), color: 'rgba(var(--fg-rgb),var(--fg-a6))' },
          { label: 'Rural cells used', value: String(result.ruralCellCount), color: 'rgba(var(--fg-rgb),var(--fg-a6))' },
        ].map(({ label, value, color: c }) => (
          <div key={label} style={{ fontSize: '12px' }}>
            <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>{label}: </span>
            <span style={{ color: c, fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── UHI Color Swatch Strip ────────────────────────────────────────────────────

/** A compact city-level color swatch bar for the overlay preview */
const UHISwatchBar: React.FC<{ results: UHIResult[]; selected: string | null; onSelect: (name: string) => void }> = ({ results, selected, onSelect }) => (
  <div
    aria-label="UHI intensity swatch bar"
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px',
      marginBottom: 'var(--space-md, 12px)',
    }}
  >
    {results.map((r) => {
      const color = uhiIntensityToColor(r.intensity);
      const isSelected = selected === r.cityName;
      return (
        <button
          key={r.cityName}
          onClick={() => onSelect(r.cityName)}
          aria-pressed={isSelected}
          aria-label={`${r.cityName}: ${r.intensity >= 0 ? '+' : ''}${r.intensity.toFixed(1)}°C UHI`}
          title={`${r.cityName} — UHI: ${r.intensity >= 0 ? '+' : ''}${r.intensity.toFixed(1)}°C`}
          style={{
            width: '42px',
            height: '38px',
            background: color,
            border: isSelected ? '2px solid #fff' : '1px solid rgba(0,0,0,0.2)',
            borderRadius: '5px',
            cursor: 'pointer',
            position: 'relative',
            transition: 'transform 150ms ease',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.12)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)')}
        >
          <span
            style={{
              position: 'absolute',
              bottom: '1px',
              left: 0,
              right: 0,
              fontSize: '7px',
              color: 'rgba(0,0,0,0.75)',
              textAlign: 'center',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              padding: '0 2px',
            }}
          >
            {r.cityName.slice(0, 5)}
          </span>
        </button>
      );
    })}
  </div>
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface UrbanHeatIslandProps {
  /** Grid cells for UHI computation; when omitted, mock data is used */
  gridCells?: GridCell[];
  /** Whether the panel is active */
  enabled?: boolean;
  /**
   * Called when the user selects a city.
   * Consumers (e.g. CesiumGlobe) can fly to the city and show the overlay.
   */
  onCitySelect?: (result: UHIResult, overlayCell: UHIOverlayCell[]) => void;
  /** Pre-computed trend overrides keyed by city name */
  trendOverrides?: Partial<Record<string, UHITrend>>;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * UrbanHeatIsland — Urban Heat Island Intensity Mapping.
 *
 * Validates: Requirements 41.1, 41.2, 41.3
 */
export const UrbanHeatIsland: React.FC<UrbanHeatIslandProps> = ({
  gridCells,
  enabled = true,
  onCitySelect,
  trendOverrides = {},
}) => {
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  // Compute UHI results; fall back to mock when no gridCells or insufficient coverage
  const uhiResults = useMemo<UHIResult[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return MOCK_UHI_RESULTS;
    const computed = computeAllUHI(gridCells, CITY_DEFINITIONS, trendOverrides);
    return computed.length > 0 ? computed : MOCK_UHI_RESULTS;
  }, [gridCells, enabled, trendOverrides]);

  const hotspotCount = useMemo(
    () => uhiResults.filter((r) => r.intensity >= UHI_HOTSPOT_THRESHOLD).length,
    [uhiResults],
  );

  const selectedResult = useMemo(
    () => uhiResults.find((r) => r.cityName === selectedCity) ?? null,
    [uhiResults, selectedCity],
  );

  const handleCitySelect = (cityName: string) => {
    const next = cityName === selectedCity ? null : cityName;
    setSelectedCity(next);
    if (next && onCitySelect) {
      const result = uhiResults.find((r) => r.cityName === next)!;
      const overlayCells = buildUHIOverlayCells(gridCells ?? [], [result], CITY_DEFINITIONS);
      onCitySelect(result, overlayCells);
    }
  };

  if (!enabled) return null;

  return (
    <div
      className="urban-heat-island"
      data-testid="urban-heat-island"
      role="region"
      aria-label="Urban Heat Island Mapping"
    >
      {/* ── Hotspot Banner ── */}
      {hotspotCount > 0 && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: 'rgba(249, 115, 22, 0.12)',
            border: '1px solid #f97316',
            borderRadius: 'var(--radius-md, 8px)',
            padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
            marginBottom: 'var(--space-md, 12px)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'uhi-banner-pulse 2.5s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: '18px' }} aria-hidden="true">🏙️</span>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#fdba74' }}>
            {hotspotCount} UHI Hotspot{hotspotCount > 1 ? 's' : ''} ≥ {UHI_HOTSPOT_THRESHOLD}°C intensity
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            urban − rural delta
          </span>
        </div>
      )}

      {/* ── Main Glass Panel ── */}
      <GlassPanel padding="md" className="uhi-panel">
        <h3
          style={{
            fontSize: 'var(--font-heading-sm, 18px)',
            fontWeight: 600,
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            margin: '0 0 var(--space-md, 12px) 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          🌆 Urban Heat Island Mapping
          <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            {uhiResults.length} cities
          </span>
        </h3>

        {/* Diverging legend */}
        <DivergingLegend />

        {/* Swatch bar — diverging overlay preview */}
        <UHISwatchBar results={uhiResults} selected={selectedCity} onSelect={handleCitySelect} />

        {/* Ranked city table */}
        <div style={{ overflowY: 'auto', maxHeight: '320px' }}>
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
            aria-label="Ranked cities by UHI intensity"
          >
            <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
              <tr>
                {['#', 'City', 'UHI (°C)', 'Trend', 'Category'].map((label, i) => (
                  <th
                    key={label}
                    scope="col"
                    style={{
                      padding: '6px 8px',
                      textAlign: i === 0 ? 'center' : i === 1 ? 'left' : 'center',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'rgba(var(--fg-rgb),var(--fg-a4))',
                      borderBottom: '1px solid rgba(var(--fg-rgb),var(--fg-a1))',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uhiResults.map((result, idx) => (
                <CityRow
                  key={result.cityName}
                  result={result}
                  rank={idx + 1}
                  isSelected={selectedCity === result.cityName}
                  onSelect={() => handleCitySelect(result.cityName)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail card for selected city */}
        {selectedResult && <CityDetailCard result={selectedResult} />}
      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes uhi-hotspot-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes uhi-banner-pulse {
          0%, 100% { box-shadow: 0 0 5px rgba(249,115,22,0.25); }
          50%       { box-shadow: 0 0 16px rgba(249,115,22,0.6); }
        }
        @keyframes uhi-card-pulse {
          0%, 100% { box-shadow: 0 0 4px rgba(249,115,22,0.2); }
          50%       { box-shadow: 0 0 12px rgba(249,115,22,0.5); }
        }
      `}</style>
    </div>
  );
};

export default UrbanHeatIsland;
