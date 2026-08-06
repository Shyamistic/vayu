/**
 * OrographicAnalysis — Elevation-Aware Orographic Analysis.
 *
 * Exports pure functions (testable) plus a React component that:
 *  1. Overlays terrain elevation contours (200m, 500m, 1000m, 1500m, 2000m)
 *     simultaneously with the rainfall heatmap (Req 34.1)
 *  2. Provides a scatter plot panel showing elevation vs rainfall for all
 *     visible grid cells with a linear regression trend line (Req 34.2)
 *  3. Displays elevation labels at mountain peaks when exaggeration > 2× (Req 34.3)
 *  4. Computes an "Orographic Enhancement Factor" for the Western Ghats
 *     transect (Req 34.4)
 *
 * Elevation data is approximated using a lookup table keyed to the 0.25° grid
 * for the Indian sub-continent. In production this would come from a SRTM/
 * ASTER DEM tile service.
 *
 * Validates: Requirements 34.1, 34.2, 34.3, 34.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A grid cell annotated with the nearest-lookup terrain elevation (m). */
export interface ElevatedCell {
  lat: number;
  lon: number;
  rainfall: number;
  /** Terrain elevation in metres (from DEM lookup table) */
  elevationM: number;
}

/** Contour band definition */
export interface ContourBand {
  /** Lower elevation bound (metres) */
  minM: number;
  /** Upper elevation bound (metres) */
  maxM: number;
  /** CSS colour for this band */
  color: string;
  /** Label shown on the legend */
  label: string;
}

/** Result of the linear regression over elevation vs rainfall. */
export interface RegressionResult {
  /** Slope: mm of rainfall per metre of elevation */
  slope: number;
  /** Intercept (mm) */
  intercept: number;
  /** Pearson correlation coefficient */
  r: number;
  /** R² coefficient of determination */
  r2: number;
  /** Number of points used */
  n: number;
}

/** Orographic Enhancement Factor result */
export interface OEFResult {
  /** Mean rainfall on the windward (western) side (mm) */
  windwardMeanMm: number;
  /** Mean rainfall on the leeward (eastern) side (mm) */
  leewardMeanMm: number;
  /**
   * OEF = windwardMeanMm / leewardMeanMm.
   * Values > 1 indicate windward enhancement.
   * Returns Infinity when leeward mean is 0.
   */
  oef: number;
  /** Number of windward cells used */
  windwardCells: number;
  /** Number of leeward cells used */
  leewardCells: number;
}

/** A mountain peak to label at high terrain exaggeration */
export interface PeakLabel {
  name: string;
  lat: number;
  lon: number;
  elevationM: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The five elevation contour levels required by Req 34.1.
 * Each band covers from minM to maxM with a distinct colour.
 */
export const ELEVATION_CONTOUR_LEVELS: number[] = [200, 500, 1000, 1500, 2000];

/** Visual bands between consecutive contour levels */
export const ELEVATION_BANDS: ContourBand[] = [
  { minM: 0,    maxM: 200,  color: '#4ade8055', label: '0–200 m'    },
  { minM: 200,  maxM: 500,  color: '#a3e63555', label: '200–500 m'  },
  { minM: 500,  maxM: 1000, color: '#facc1555', label: '500–1000 m' },
  { minM: 1000, maxM: 1500, color: '#fb923c55', label: '1000–1500 m'},
  { minM: 1500, maxM: 2000, color: '#f8717155', label: '1500–2000 m'},
  { minM: 2000, maxM: Infinity, color: '#a78bfa55', label: '> 2000 m'  },
];

/**
 * Western Ghats transect bounds (Req 34.4).
 * The windward (west-facing) slope lies roughly between 73°E–75°E.
 * The leeward (east-facing / rain-shadow) slope lies between 76°E–78°E.
 * Both are bounded between 8°N and 21°N (approximate range of the Ghats).
 */
export const WG_LAT_MIN = 8;
export const WG_LAT_MAX = 21;
export const WG_WINDWARD_LON_MIN = 73.0;
export const WG_WINDWARD_LON_MAX = 75.0;
export const WG_LEEWARD_LON_MIN  = 76.0;
export const WG_LEEWARD_LON_MAX  = 78.0;

/** Major peaks for elevation labels at high exaggeration (Req 34.3) */
export const MAJOR_PEAKS: PeakLabel[] = [
  { name: 'Anamudi',      lat: 10.17, lon: 77.07, elevationM: 2695 },
  { name: 'Doddabetta',   lat: 11.40, lon: 76.74, elevationM: 2637 },
  { name: 'Mullayanagiri',lat: 13.39, lon: 75.74, elevationM: 1930 },
  { name: 'Kalsubai',     lat: 19.60, lon: 73.71, elevationM: 1646 },
  { name: 'Sandakphu',    lat: 27.10, lon: 88.00, elevationM: 3636 },
  { name: 'Nanda Devi',   lat: 30.37, lon: 79.99, elevationM: 7816 },
  { name: 'Kangchenjunga',lat: 27.70, lon: 88.15, elevationM: 8586 },
];

// ── DEM Lookup Table ──────────────────────────────────────────────────────────

/**
 * Approximate terrain elevation (m) for key 0.25° grid cells over India.
 * Key format: `${lat.toFixed(2)}_${lon.toFixed(2)}`.
 *
 * In production this would be fetched from a SRTM/ASTER tile service.
 * Here we provide representative values for the Western Ghats transect and
 * major mountain ranges so the analysis functions produce realistic output.
 */
const DEM_LOOKUP: Record<string, number> = {
  // Western Ghats — windward (west) slope
  '10.00_76.25': 400,  '10.25_76.00': 350,  '10.50_76.25': 600,
  '10.75_76.25': 750,  '11.00_76.25': 900,  '11.25_76.00': 1100,
  '11.50_75.75': 1300, '11.75_75.75': 1500, '12.00_75.75': 1200,
  '12.25_75.50': 1000, '12.50_75.50': 800,  '12.75_75.25': 700,
  '13.00_75.25': 600,  '13.25_74.75': 800,  '13.50_74.75': 1100,
  '13.75_74.75': 1400, '14.00_74.50': 1600, '14.25_74.25': 1800,
  '14.50_74.25': 2000, '14.75_74.25': 1700, '15.00_74.25': 1400,
  '15.25_74.25': 1200, '15.50_74.00': 900,  '15.75_73.75': 700,
  '16.00_73.75': 600,  '16.25_73.75': 500,  '16.50_73.50': 400,
  '17.00_73.50': 350,  '17.25_73.50': 300,  '17.50_73.75': 250,
  '18.00_73.75': 200,  '18.25_73.75': 300,  '18.50_73.75': 500,
  '19.00_73.75': 700,  '19.25_73.75': 900,  '19.50_73.75': 1100,
  '19.75_73.75': 1300, '20.00_74.00': 1000, '20.25_74.00': 700,
  '20.50_74.00': 500,  '20.75_74.25': 400,  '21.00_74.25': 300,
  // Western Ghats — leeward (east) / rain shadow
  '10.00_77.50': 200,  '10.25_77.25': 150,  '10.50_77.25': 100,
  '11.00_77.25': 80,   '11.50_77.00': 60,   '12.00_77.25': 50,
  '12.50_77.00': 30,   '13.00_77.25': 40,   '13.50_77.25': 60,
  '14.00_77.25': 80,   '14.50_77.25': 100,  '15.00_77.00': 120,
  '16.00_77.00': 80,   '17.00_77.25': 60,   '18.00_77.25': 50,
  // Himalayas
  '27.00_88.00': 3500, '28.00_84.00': 4200, '29.00_80.00': 5000,
  '30.00_79.00': 5500, '31.00_77.00': 4800, '32.00_77.00': 4200,
  // Plains
  '25.00_83.00': 80,   '26.00_82.00': 70,   '27.00_80.00': 60,
  '28.00_77.00': 200,  '29.00_76.00': 220,  '22.00_82.00': 300,
  '20.00_79.00': 350,  '18.00_79.00': 400,  '16.00_79.00': 100,
};

/**
 * Look up the approximate terrain elevation (m) for a given lat/lon.
 * Snaps to the nearest 0.25° grid point, then falls back to a simple
 * latitudinal gradient model (plains ~100m, hills at higher latitudes).
 */
export function lookupElevation(lat: number, lon: number): number {
  // Snap to nearest 0.25°
  const snapLat = Math.round(lat * 4) / 4;
  const snapLon = Math.round(lon * 4) / 4;
  const key = `${snapLat.toFixed(2)}_${snapLon.toFixed(2)}`;
  if (DEM_LOOKUP[key] !== undefined) return DEM_LOOKUP[key];

  // Fallback: approximate from lat/lon heuristics for India
  // Western Ghats corridor (roughly 73–77°E, 8–21°N)
  if (lon >= 73 && lon <= 77 && lat >= 8 && lat <= 21) {
    const distFromCrestLon = Math.abs(lon - 75.5);
    return Math.max(50, 1200 - distFromCrestLon * 600);
  }
  // Himalayan corridor (lat > 27, lon 73–88°E)
  if (lat > 27 && lon >= 73 && lon <= 88) {
    return Math.max(500, (lat - 27) * 600);
  }
  // Default plains
  return Math.max(50, 100 + (lat - 8) * 5);
}

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Annotate grid cells with terrain elevation.
 *
 * Validates: Requirement 34.1 (elevation data for contour overlay)
 */
export function buildElevatedCells(gridCells: GridCell[]): ElevatedCell[] {
  return gridCells.map((cell) => ({
    lat: cell.lat,
    lon: cell.lon,
    rainfall: cell.rainfall,
    elevationM: lookupElevation(cell.lat, cell.lon),
  }));
}

/**
 * Classify an elevation value into one of the contour bands.
 *
 * Returns the matching ContourBand or the last band (>2000m) as fallback.
 *
 * Validates: Requirement 34.1
 */
export function classifyElevationBand(elevationM: number): ContourBand {
  for (const band of ELEVATION_BANDS) {
    if (elevationM >= band.minM && elevationM < band.maxM) return band;
  }
  return ELEVATION_BANDS[ELEVATION_BANDS.length - 1];
}

/**
 * Perform ordinary least-squares linear regression of rainfall (y) on
 * elevation (x) for a set of ElevatedCells.
 *
 * Returns null when fewer than 2 points are provided.
 *
 * Validates: Requirement 34.2 (linear regression trend line)
 */
export function computeLinearRegression(
  cells: ElevatedCell[],
): RegressionResult | null {
  const n = cells.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const c of cells) {
    sumX  += c.elevationM;
    sumY  += c.rainfall;
    sumXY += c.elevationM * c.rainfall;
    sumX2 += c.elevationM * c.elevationM;
    sumY2 += c.rainfall * c.rainfall;
  }

  const meanX = sumX / n;
  const meanY = sumY / n;
  const ssXX = sumX2 - n * meanX * meanX;
  const ssYY = sumY2 - n * meanY * meanY;
  const ssXY = sumXY - n * meanX * meanY;

  if (ssXX === 0) {
    // All cells at the same elevation — return zero slope
    return { slope: 0, intercept: meanY, r: 0, r2: 0, n };
  }

  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r = ssYY === 0 ? 0 : ssXY / Math.sqrt(ssXX * ssYY);
  const r2 = r * r;

  return { slope, intercept, r, r2, n };
}

/**
 * Compute the Orographic Enhancement Factor for the Western Ghats transect.
 *
 * OEF = mean_windward_rainfall / mean_leeward_rainfall
 *
 * Windward = cells with lon in [WG_WINDWARD_LON_MIN, WG_WINDWARD_LON_MAX]
 * Leeward  = cells with lon in [WG_LEEWARD_LON_MIN,  WG_LEEWARD_LON_MAX]
 * Both restricted to lat [WG_LAT_MIN, WG_LAT_MAX].
 *
 * Validates: Requirement 34.4
 */
export function computeOEF(cells: ElevatedCell[]): OEFResult | null {
  const windward = cells.filter(
    (c) =>
      c.lat >= WG_LAT_MIN && c.lat <= WG_LAT_MAX &&
      c.lon >= WG_WINDWARD_LON_MIN && c.lon <= WG_WINDWARD_LON_MAX,
  );
  const leeward = cells.filter(
    (c) =>
      c.lat >= WG_LAT_MIN && c.lat <= WG_LAT_MAX &&
      c.lon >= WG_LEEWARD_LON_MIN && c.lon <= WG_LEEWARD_LON_MAX,
  );

  if (windward.length === 0 || leeward.length === 0) return null;

  const windwardMean =
    windward.reduce((s, c) => s + c.rainfall, 0) / windward.length;
  const leewardMean =
    leeward.reduce((s, c) => s + c.rainfall, 0) / leeward.length;

  return {
    windwardMeanMm: windwardMean,
    leewardMeanMm: leewardMean,
    oef: leewardMean === 0 ? Infinity : windwardMean / leewardMean,
    windwardCells: windward.length,
    leewardCells: leeward.length,
  };
}

/**
 * Get peak labels that should be displayed at the given terrain exaggeration.
 * Labels are shown only when exaggeration > 2× (Req 34.3).
 */
export function getPeakLabels(terrainExaggeration: number): PeakLabel[] {
  if (terrainExaggeration <= 2) return [];
  return MAJOR_PEAKS;
}

/**
 * Map elevation (m) to a CSS color for the contour bands legend.
 * Delegates to classifyElevationBand.
 */
export function elevationToColor(elevationM: number): string {
  return classifyElevationBand(elevationM).color;
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

/**
 * Mock ElevatedCells for the Western Ghats transect (demo / fallback).
 * Represents a transect from the coast (~73°E) across the crest (~75.5°E)
 * to the rain shadow (~77.5°E) at ~15°N.
 */
export const MOCK_ELEVATED_CELLS: ElevatedCell[] = [
  { lat: 15.0, lon: 73.0, elevationM:  50, rainfall: 8  },
  { lat: 15.0, lon: 73.5, elevationM: 200, rainfall: 15 },
  { lat: 15.0, lon: 74.0, elevationM: 500, rainfall: 28 },
  { lat: 15.0, lon: 74.5, elevationM: 900, rainfall: 42 },
  { lat: 15.0, lon: 75.0, elevationM:1400, rainfall: 58 },
  { lat: 15.0, lon: 75.5, elevationM:1800, rainfall: 65 },
  { lat: 15.0, lon: 76.0, elevationM:1200, rainfall: 45 },
  { lat: 15.0, lon: 76.5, elevationM: 600, rainfall: 22 },
  { lat: 15.0, lon: 77.0, elevationM: 300, rainfall: 12 },
  { lat: 15.0, lon: 77.5, elevationM: 100, rainfall:  7 },
  { lat: 15.0, lon: 78.0, elevationM:  80, rainfall:  5 },
  // Additional rows for scatter plot density
  { lat: 12.0, lon: 74.5, elevationM:1100, rainfall: 50 },
  { lat: 12.0, lon: 75.5, elevationM:2000, rainfall: 70 },
  { lat: 12.0, lon: 76.5, elevationM: 700, rainfall: 20 },
  { lat: 18.0, lon: 73.5, elevationM: 300, rainfall: 18 },
  { lat: 18.0, lon: 74.5, elevationM: 900, rainfall: 38 },
  { lat: 18.0, lon: 75.5, elevationM:1500, rainfall: 55 },
  { lat: 18.0, lon: 76.5, elevationM: 500, rainfall: 16 },
  { lat: 10.0, lon: 77.0, elevationM: 200, rainfall: 12 },
  { lat: 10.0, lon: 76.0, elevationM: 900, rainfall: 48 },
];

// ── Sub-components ────────────────────────────────────────────────────────────

/** Elevation contour legend (Req 34.1) */
const ElevationLegend: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      marginBottom: 'var(--space-md, 12px)',
    }}
    aria-label="Elevation contour bands"
  >
    {ELEVATION_BANDS.map((band) => (
      <div
        key={band.label}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          color: 'rgba(var(--fg-rgb),var(--fg-a7))',
        }}
      >
        <span
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '3px',
            background: band.color,
            border: '1px solid rgba(var(--fg-rgb),var(--fg-a15))',
            display: 'inline-block',
          }}
          aria-hidden="true"
        />
        {band.label}
      </div>
    ))}
  </div>
);

/** OEF result card (Req 34.4) */
const OEFCard: React.FC<{ oef: OEFResult }> = ({ oef }) => {
  const isEnhanced = oef.oef > 1.5;
  const color = oef.oef > 3 ? '#f87171' : oef.oef > 2 ? '#fb923c' : '#4ade80';

  return (
    <div
      role="region"
      aria-label="Orographic Enhancement Factor"
      style={{
        background: `${color}12`,
        border: `1px solid ${color}50`,
        borderRadius: '8px',
        padding: '10px 12px',
        marginBottom: 'var(--space-md, 12px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(var(--fg-rgb),var(--fg-a75))' }}>
          ⛰️ Orographic Enhancement Factor
        </span>
        <span style={{ fontSize: '20px', fontWeight: 700, color }}>
          {isFinite(oef.oef) ? oef.oef.toFixed(2) : '∞'}×
        </span>
      </div>

      <div style={{ fontSize: '11px', color: isEnhanced ? '#fbbf24' : '#86efac', fontWeight: 600, marginBottom: '6px' }}>
        {oef.oef > 3
          ? 'Extreme windward enhancement'
          : oef.oef > 2
            ? 'Strong orographic enhancement'
            : oef.oef > 1.5
              ? 'Moderate orographic enhancement'
              : 'Weak or no orographic enhancement'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        {[
          { label: 'Windward mean', value: `${oef.windwardMeanMm.toFixed(1)} mm`, color: '#60a5fa', cells: oef.windwardCells },
          { label: 'Leeward mean',  value: `${oef.leewardMeanMm.toFixed(1)} mm`,  color: '#f59e0b', cells: oef.leewardCells  },
        ].map(({ label, value, color: c, cells }) => (
          <div key={label} style={{ fontSize: '11px' }}>
            <div style={{ color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>{label}</div>
            <div style={{ color: c, fontWeight: 600 }}>{value}</div>
            <div style={{ color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontSize: '10px' }}>{cells} cells</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Regression statistics row */
const RegressionStats: React.FC<{ reg: RegressionResult }> = ({ reg }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '6px',
      marginTop: '8px',
      fontSize: '11px',
    }}
  >
    {[
      { label: 'Slope',       value: `${reg.slope.toFixed(4)} mm/m` },
      { label: 'R²',          value: reg.r2.toFixed(3) },
      { label: 'Correlation', value: reg.r.toFixed(3)  },
    ].map(({ label, value }) => (
      <div
        key={label}
        style={{
          background: 'rgba(var(--fg-rgb),var(--fg-a05))',
          borderRadius: '6px',
          padding: '5px 8px',
          textAlign: 'center',
        }}
      >
        <div style={{ color: 'rgba(var(--fg-rgb),var(--fg-a4))', fontSize: '10px' }}>{label}</div>
        <div style={{ color: '#93c5fd', fontWeight: 600 }}>{value}</div>
      </div>
    ))}
  </div>
);

/** Scatter plot: elevation (x) vs rainfall (y) with regression line (Req 34.2) */
const ElevationRainfallScatter: React.FC<{
  cells: ElevatedCell[];
  regression: RegressionResult | null;
}> = ({ cells, regression }) => {
  if (cells.length === 0) return null;

  const W = 300;
  const H = 180;
  const padL = 44;
  const padB = 28;
  const padT = 10;
  const padR = 10;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxElev = Math.max(...cells.map((c) => c.elevationM), 2200);
  const maxRain = Math.max(...cells.map((c) => c.rainfall), 10);

  const toX = (e: number) => padL + (e / maxElev) * plotW;
  const toY = (r: number) => padT + plotH - (r / maxRain) * plotH;

  // Regression line endpoints
  let regLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (regression) {
    const rMin = regression.intercept;
    const rMax = regression.slope * maxElev + regression.intercept;
    regLine = {
      x1: toX(0),      y1: toY(Math.max(0, rMin)),
      x2: toX(maxElev), y2: toY(Math.max(0, rMax)),
    };
  }

  // Elevation band colors for dots
  const dotColor = (elev: number) => classifyElevationBand(elev).color.replace('55', 'dd');

  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '4px' }}>
        Elevation vs Rainfall scatter ({cells.length} cells)
      </div>
      <svg
        width={W}
        height={H}
        style={{ display: 'block', overflow: 'visible' }}
        role="img"
        aria-label="Scatter plot of terrain elevation versus rainfall for visible grid cells"
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={`h${f}`}
            x1={padL} y1={padT + f * plotH}
            x2={padL + plotW} y2={padT + f * plotH}
            stroke="rgba(var(--fg-rgb),var(--fg-a05))"
            strokeWidth="1"
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={`v${f}`}
            x1={padL + f * plotW} y1={padT}
            x2={padL + f * plotW} y2={padT + plotH}
            stroke="rgba(var(--fg-rgb),var(--fg-a05))"
            strokeWidth="1"
          />
        ))}

        {/* Axes */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="rgba(var(--fg-rgb),var(--fg-a2))" strokeWidth="1" />
        <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="rgba(var(--fg-rgb),var(--fg-a2))" strokeWidth="1" />

        {/* Regression line */}
        {regLine && (
          <line
            x1={regLine.x1} y1={regLine.y1}
            x2={regLine.x2} y2={regLine.y2}
            stroke="#f87171"
            strokeWidth="1.5"
            strokeDasharray="4,2"
            aria-label="Linear regression trend line"
          />
        )}

        {/* Data points */}
        {cells.map((c, i) => (
          <circle
            key={i}
            cx={toX(c.elevationM)}
            cy={toY(c.rainfall)}
            r={3}
            fill={dotColor(c.elevationM)}
            stroke="rgba(var(--fg-rgb),var(--fg-a2))"
            strokeWidth="0.5"
          >
            <title>{`Elev: ${c.elevationM}m, Rain: ${c.rainfall.toFixed(1)}mm`}</title>
          </circle>
        ))}

        {/* X-axis labels (elevation) */}
        {[0, 500, 1000, 1500, 2000].filter((v) => v <= maxElev).map((v) => (
          <text
            key={v}
            x={toX(v)} y={H - 6}
            textAnchor="middle"
            fontSize="9"
            fill="rgba(var(--fg-rgb),var(--fg-a4))"
          >
            {v >= 1000 ? `${v / 1000}k` : v}
          </text>
        ))}

        {/* Y-axis labels (rainfall) */}
        {[0, 25, 50, 75].filter((v) => v <= maxRain).map((v) => (
          <text
            key={v}
            x={padL - 4} y={toY(v) + 4}
            textAnchor="end"
            fontSize="9"
            fill="rgba(var(--fg-rgb),var(--fg-a4))"
          >
            {v}
          </text>
        ))}

        {/* Axis labels */}
        <text
          x={padL + plotW / 2} y={H - 0}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(var(--fg-rgb),var(--fg-a4))"
        >
          Elevation (m)
        </text>
        <text
          x={8} y={padT + plotH / 2}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(var(--fg-rgb),var(--fg-a4))"
          transform={`rotate(-90, 8, ${padT + plotH / 2})`}
        >
          Rain (mm)
        </text>
      </svg>
    </div>
  );
};

/** Peak labels list (Req 34.3) shown only when terrainExaggeration > 2 */
const PeakLabelList: React.FC<{ peaks: PeakLabel[] }> = ({ peaks }) => {
  if (peaks.length === 0) return null;
  return (
    <div
      style={{
        marginTop: '8px',
        background: 'rgba(167,139,250,0.08)',
        border: '1px solid rgba(167,139,250,0.25)',
        borderRadius: '7px',
        padding: '8px 10px',
      }}
      role="region"
      aria-label="Mountain peak labels"
    >
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#c4b5fd', marginBottom: '6px' }}>
        ▲ Mountain Peak Labels (exaggeration &gt; 2×)
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {peaks.map((p) => (
          <span
            key={p.name}
            title={`${p.lat}°N ${p.lon}°E`}
            style={{
              fontSize: '10px',
              background: 'rgba(167,139,250,0.15)',
              border: '1px solid rgba(167,139,250,0.3)',
              borderRadius: '4px',
              padding: '2px 6px',
              color: '#ddd6fe',
            }}
          >
            {p.name} {p.elevationM >= 1000 ? `${(p.elevationM / 1000).toFixed(1)}km` : `${p.elevationM}m`}
          </span>
        ))}
      </div>
    </div>
  );
};

// ── Main Component Props ──────────────────────────────────────────────────────

export interface OrographicAnalysisProps {
  /** Grid cells for analysis; if empty, falls back to mock data */
  gridCells?: GridCell[];
  /** Whether the panel is active */
  enabled?: boolean;
  /** Current terrain exaggeration factor (1–5); controls peak labels (Req 34.3) */
  terrainExaggeration?: number;
  /**
   * Called when elevated cell data is ready, so parent can drive the globe
   * contour overlay (Req 34.1).
   */
  onElevatedCells?: (cells: ElevatedCell[]) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * OrographicAnalysis — elevation-aware orographic analysis panel.
 *
 * Validates: Requirements 34.1, 34.2, 34.3, 34.4
 */
export const OrographicAnalysis: React.FC<OrographicAnalysisProps> = ({
  gridCells,
  enabled = true,
  terrainExaggeration = 1,
  onElevatedCells,
}) => {
  const [showScatter, setShowScatter] = useState(true);

  // Build elevated cells — fallback to mock when no real data provided
  const elevatedCells = useMemo<ElevatedCell[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return MOCK_ELEVATED_CELLS;
    const cells = buildElevatedCells(gridCells);
    return cells.length > 0 ? cells : MOCK_ELEVATED_CELLS;
  }, [gridCells, enabled]);

  // Notify parent when elevated cells change
  React.useEffect(() => {
    if (enabled && onElevatedCells && elevatedCells.length > 0) {
      onElevatedCells(elevatedCells);
    }
  }, [elevatedCells, enabled, onElevatedCells]);

  // Linear regression (Req 34.2)
  const regression = useMemo(
    () => computeLinearRegression(elevatedCells),
    [elevatedCells],
  );

  // OEF (Req 34.4)
  const oef = useMemo(() => computeOEF(elevatedCells), [elevatedCells]);

  // Peak labels — only when exaggeration > 2 (Req 34.3)
  const peakLabels = useMemo(
    () => getPeakLabels(terrainExaggeration),
    [terrainExaggeration],
  );

  // Summary statistics for header
  const elevStats = useMemo(() => {
    if (elevatedCells.length === 0) return { min: 0, max: 0, mean: 0 };
    const elevs = elevatedCells.map((c) => c.elevationM);
    const min = Math.min(...elevs);
    const max = Math.max(...elevs);
    const mean = elevs.reduce((s, v) => s + v, 0) / elevs.length;
    return { min, max, mean };
  }, [elevatedCells]);

  if (!enabled) return null;

  return (
    <div
      className="orographic-analysis"
      data-testid="orographic-analysis"
      role="region"
      aria-label="Elevation-Aware Orographic Analysis"
    >
      {/* ── Main Glass Panel ── */}
      <GlassPanel padding="md" className="orographic-panel">
        {/* Header */}
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
          ⛰️ Orographic Analysis
          <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            {elevatedCells.length} cells
          </span>
        </h3>

        {/* Elevation summary stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '6px',
            marginBottom: 'var(--space-md, 12px)',
          }}
        >
          {[
            { label: 'Min Elev',  value: `${elevStats.min.toFixed(0)}m`,  color: '#4ade80' },
            { label: 'Mean Elev', value: `${elevStats.mean.toFixed(0)}m`, color: '#60a5fa' },
            { label: 'Max Elev',  value: `${elevStats.max.toFixed(0)}m`,  color: '#c084fc' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                background: 'rgba(var(--fg-rgb),var(--fg-a05))',
                borderRadius: '6px',
                padding: '5px 8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>{label}</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Elevation contour legend (Req 34.1) */}
        <div style={{ marginBottom: '4px', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', fontWeight: 600 }}>
          Elevation Contour Bands
        </div>
        <ElevationLegend />

        {/* OEF card (Req 34.4) */}
        {oef ? (
          <OEFCard oef={oef} />
        ) : (
          <div
            style={{
              fontSize: '11px',
              color: 'rgba(var(--fg-rgb),var(--fg-a4))',
              fontStyle: 'italic',
              marginBottom: '10px',
              padding: '8px',
              background: 'rgba(var(--fg-rgb),var(--fg-a05))',
              borderRadius: '6px',
              border: '1px solid rgba(var(--fg-rgb),var(--fg-a05))',
            }}
          >
            OEF not available — grid cells outside Western Ghats transect bounds.
            Zoom into the Western Ghats (8–21°N, 73–78°E) to compute the Orographic Enhancement Factor.
          </div>
        )}

        {/* Peak labels (Req 34.3) */}
        <PeakLabelList peaks={peakLabels} />
        {peakLabels.length === 0 && terrainExaggeration <= 2 && (
          <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginBottom: '8px', fontStyle: 'italic' }}>
            Increase terrain exaggeration above 2× to reveal mountain peak labels.
          </div>
        )}

        {/* Scatter plot toggle */}
        <button
          onClick={() => setShowScatter((v) => !v)}
          aria-expanded={showScatter}
          aria-controls="orographic-scatter"
          style={{
            width: '100%',
            background: 'rgba(var(--fg-rgb),var(--fg-a05))',
            border: '1px solid rgba(var(--fg-rgb),var(--fg-a1))',
            borderRadius: '6px',
            padding: '6px 10px',
            color: 'rgba(var(--fg-rgb),var(--fg-a7))',
            fontSize: '11px',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: showScatter ? '0' : undefined,
          }}
        >
          <span>📈 Elevation vs Rainfall Scatter</span>
          <span>{showScatter ? '▲' : '▼'}</span>
        </button>

        {/* Scatter plot panel (Req 34.2) */}
        {showScatter && (
          <div id="orographic-scatter">
            <ElevationRainfallScatter cells={elevatedCells} regression={regression} />
            {regression && <RegressionStats reg={regression} />}
          </div>
        )}
      </GlassPanel>

      <style>{`
        @keyframes orographic-pulse {
          0%, 100% { box-shadow: 0 0 4px rgba(167,139,250,0.2); }
          50%       { box-shadow: 0 0 12px rgba(167,139,250,0.5); }
        }
      `}</style>
    </div>
  );
};

export default OrographicAnalysis;
