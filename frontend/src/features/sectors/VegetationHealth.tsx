/**
 * VegetationHealth — NDVI monitoring and Vegetation Stress Index (VSI) computation.
 *
 * Exports pure functions for VSI computation (testable), plus a React component:
 *  1. NDVI color-coded overlay data for the globe (from NASA GIBS palette)
 *  2. Vegetation Stress Index (0–100) per grid cell
 *  3. Crop Stress Alerts when VSI > 70
 *  4. Temporal NDVI profiles showing seasonal evolution
 *
 * VSI combines NDVI anomaly with temperature stress:
 *   ndviAnomaly = (currentNDVI - meanNDVI) / stdNDVI   [normalized]
 *   tempStress  = clamp((temp_max - 35) / 10, 0, 1)    [heat stress 35–45°C]
 *   VSI = clamp(round((0.6 * |ndviAnomaly| + 0.4 * tempStress) * 100), 0, 100)
 *
 * Validates: Requirements 57.1, 57.2, 57.3, 57.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** NDVI value in [-1, 1]. Healthy vegetation: > 0.3; sparse/no veg: < 0.1 */
export type NDVIValue = number;

/** Vegetation Stress Index: 0 (no stress) to 100 (extreme stress) */
export type VSIScore = number;

/** Alert severity level based on VSI */
export type StressLevel = 'none' | 'moderate' | 'high' | 'critical';

/** Per-cell vegetation health result */
export interface VegetationCell {
  lat: number;
  lon: number;
  /** Current NDVI value [-1, 1] */
  ndvi: NDVIValue;
  /** Long-term mean NDVI for this cell */
  meanNDVI: NDVIValue;
  /** Long-term std NDVI for this cell */
  stdNDVI: number;
  /** Vegetation Stress Index [0, 100] */
  vsi: VSIScore;
  /** Stress level category */
  stressLevel: StressLevel;
  /** CSS color from the NASA GIBS NDVI palette */
  ndviColor: string;
}

/** Crop stress alert generated when VSI > 70 */
export interface CropStressAlert {
  lat: number;
  lon: number;
  vsi: VSIScore;
  stressLevel: StressLevel;
  message: string;
}

/** One data point in a temporal NDVI profile */
export interface NDVIProfilePoint {
  /** Week-of-year label, e.g. "W23" */
  week: string;
  /** Current-year NDVI value */
  currentYear: NDVIValue;
  /** Multi-year average NDVI */
  multiYearAvg: NDVIValue;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** VSI threshold above which a Crop Stress Alert is generated (Req 57.3) */
export const CROP_STRESS_ALERT_THRESHOLD = 70;

/** VSI threshold boundaries for stress level classification */
export const VSI_THRESHOLDS = {
  moderate: 40,
  high: 70,
  critical: 85,
} as const;

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Map an NDVI value [-1, 1] to a CSS color following the NASA GIBS NDVI palette.
 *
 * Range      Color interpretation
 * < 0        Water / Non-vegetated → blue/grey
 * 0 – 0.1    Bare soil / sparse    → tan/brown
 * 0.1 – 0.3  Low vegetation        → yellow-green
 * 0.3 – 0.6  Moderate vegetation   → medium green
 * > 0.6      Dense/healthy canopy  → dark green
 *
 * Requirement 57.1: color-coded NDVI overlay from NASA GIBS palette.
 */
export function ndviToColor(ndvi: NDVIValue): string {
  if (ndvi < 0)    return 'rgb(70,130,180)';   // water/non-veg — steel blue
  if (ndvi < 0.1)  return 'rgb(210,180,140)';  // bare soil — tan
  if (ndvi < 0.2)  return 'rgb(210,210,80)';   // sparse — yellow
  if (ndvi < 0.3)  return 'rgb(160,210,60)';   // low vegetation — yellow-green
  if (ndvi < 0.45) return 'rgb(80,170,40)';    // moderate — medium green
  if (ndvi < 0.6)  return 'rgb(34,120,20)';    // healthy — green
  return 'rgb(0,80,10)';                        // dense canopy — dark green
}

/**
 * Compute the normalized NDVI anomaly.
 * Returns 0 when stdNDVI is 0 (degenerate/flat time series).
 */
export function ndviAnomaly(
  currentNDVI: NDVIValue,
  meanNDVI: NDVIValue,
  stdNDVI: number,
): number {
  if (stdNDVI === 0) return 0;
  return (currentNDVI - meanNDVI) / stdNDVI;
}

/**
 * Compute temperature stress component from temp_max.
 * Linear ramp from 0 (at 35°C) to 1 (at 45°C+).
 *
 * Requirement 57.2: temperature stress component.
 */
export function temperatureStress(tempMax: number): number {
  return Math.max(0, Math.min(1, (tempMax - 35) / 10));
}

/**
 * Compute Vegetation Stress Index (0–100).
 *
 * VSI = clamp(round((0.6 * |ndviAnomaly| + 0.4 * tempStress) * 100), 0, 100)
 *
 * Negative NDVI anomaly (below-average vegetation) contributes just as much
 * stress as a positive one, hence the absolute value.
 *
 * Requirement 57.2: VSI for each grid cell based on NDVI anomaly and temperature stress.
 */
export function computeVSI(
  currentNDVI: NDVIValue,
  meanNDVI: NDVIValue,
  stdNDVI: number,
  tempMax: number,
): VSIScore {
  const anomaly = ndviAnomaly(currentNDVI, meanNDVI, stdNDVI);
  const tStress  = temperatureStress(tempMax);
  const raw = (0.6 * Math.abs(anomaly) + 0.4 * tStress) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Classify a VSI score into a StressLevel category.
 */
export function classifyStress(vsi: VSIScore): StressLevel {
  if (vsi < VSI_THRESHOLDS.moderate) return 'none';
  if (vsi < VSI_THRESHOLDS.high)     return 'moderate';
  if (vsi < VSI_THRESHOLDS.critical)  return 'high';
  return 'critical';
}

/**
 * Build a human-readable Crop Stress Alert message.
 * Requirement 57.3: generate alert when VSI > 70.
 */
export function buildCropStressMessage(vsi: VSIScore, stressLevel: StressLevel): string {
  if (stressLevel === 'critical')
    return `CRITICAL crop stress (VSI ${vsi}). Irrigation and field inspection required immediately.`;
  if (stressLevel === 'high')
    return `High vegetation stress detected (VSI ${vsi}). Monitor soil moisture and consider irrigation.`;
  return `Moderate vegetation stress (VSI ${vsi}). Keep watch over the next 48 hours.`;
}

/**
 * Derive a pseudo-NDVI from a GridCell.
 *
 * In production this would come from NASA GIBS MODIS NDVI tiles; here
 * we derive a proxy from temp_max and rainfall to allow real computation
 * without an external API dependency. Higher rainfall and lower temp_max
 * correlate with healthier vegetation.
 *
 * NDVI_proxy = 0.7 * rainfall_factor + 0.3 * (1 - temp_factor) − 0.1
 *  where rainfall_factor = clamp(rainfall / 15, 0, 1)
 *        temp_factor     = clamp((temp_max - 25) / 20, 0, 1)
 *
 * Result is in [-0.1, 0.9], consistent with terrestrial vegetation range.
 */
export function estimateNDVI(cell: GridCell): NDVIValue {
  const rainfallFactor = Math.max(0, Math.min(1, cell.rainfall / 15));
  const tempFactor     = Math.max(0, Math.min(1, (cell.temp_max - 25) / 20));
  return 0.7 * rainfallFactor + 0.3 * (1 - tempFactor) - 0.1;
}

/**
 * Compute vegetation health metrics for all grid cells.
 *
 * When `ndviOverrides` is provided it supplies real NDVI values per (lat, lon);
 * otherwise estimateNDVI is used as a proxy.
 *
 * Requirement 57.2: VSI computation for each grid cell.
 */
export function computeVegetationCells(
  gridCells: GridCell[],
  ndviClimatology: Map<string, { mean: NDVIValue; std: number }> = new Map(),
  ndviOverrides: Map<string, NDVIValue> = new Map(),
): VegetationCell[] {
  return gridCells.map((cell) => {
    const key = `${cell.lat.toFixed(2)},${cell.lon.toFixed(2)}`;
    const currentNDVI = ndviOverrides.get(key) ?? estimateNDVI(cell);
    const clim = ndviClimatology.get(key) ?? { mean: 0.35, std: 0.12 };
    const vsi = computeVSI(currentNDVI, clim.mean, clim.std, cell.temp_max);
    const stressLevel = classifyStress(vsi);
    return {
      lat: cell.lat,
      lon: cell.lon,
      ndvi: currentNDVI,
      meanNDVI: clim.mean,
      stdNDVI: clim.std,
      vsi,
      stressLevel,
      ndviColor: ndviToColor(currentNDVI),
    };
  });
}

/**
 * Generate Crop Stress Alerts for all cells with VSI > CROP_STRESS_ALERT_THRESHOLD.
 * Results are sorted descending by VSI (most stressed first).
 *
 * Requirement 57.3.
 */
export function generateCropStressAlerts(vegCells: VegetationCell[]): CropStressAlert[] {
  return vegCells
    .filter((c) => c.vsi > CROP_STRESS_ALERT_THRESHOLD)
    .map((c) => ({
      lat: c.lat,
      lon: c.lon,
      vsi: c.vsi,
      stressLevel: c.stressLevel,
      message: buildCropStressMessage(c.vsi, c.stressLevel),
    }))
    .sort((a, b) => b.vsi - a.vsi);
}

// ── Mock / Demo data ──────────────────────────────────────────────────────────

/**
 * Mock temporal NDVI profile for a generic Indian agricultural cell.
 * Captures the typical kharif (June–Oct) growth and rabi (Nov–Mar) cycles.
 * Requirement 57.4: temporal NDVI profiles with seasonal comparisons.
 */
export const MOCK_NDVI_PROFILE: NDVIProfilePoint[] = [
  { week: 'W1',  currentYear: 0.18, multiYearAvg: 0.19 },
  { week: 'W5',  currentYear: 0.16, multiYearAvg: 0.18 },
  { week: 'W9',  currentYear: 0.19, multiYearAvg: 0.20 },
  { week: 'W13', currentYear: 0.22, multiYearAvg: 0.21 },
  { week: 'W17', currentYear: 0.25, multiYearAvg: 0.23 },
  { week: 'W21', currentYear: 0.28, multiYearAvg: 0.27 },
  { week: 'W23', currentYear: 0.38, multiYearAvg: 0.40 }, // monsoon onset
  { week: 'W27', currentYear: 0.62, multiYearAvg: 0.65 }, // kharif peak
  { week: 'W31', currentYear: 0.70, multiYearAvg: 0.68 },
  { week: 'W35', currentYear: 0.60, multiYearAvg: 0.63 },
  { week: 'W39', currentYear: 0.45, multiYearAvg: 0.48 }, // kharif harvest
  { week: 'W43', currentYear: 0.35, multiYearAvg: 0.37 },
  { week: 'W47', currentYear: 0.52, multiYearAvg: 0.50 }, // rabi sowing
  { week: 'W52', currentYear: 0.55, multiYearAvg: 0.53 }, // rabi growth
];

/** Fallback mock vegetation cells when no real grid data is available */
export const MOCK_VEGETATION_CELLS: VegetationCell[] = [
  { lat: 22.25, lon: 78.50, ndvi: 0.62, meanNDVI: 0.65, stdNDVI: 0.10, vsi: 22, stressLevel: 'none',     ndviColor: ndviToColor(0.62) },
  { lat: 22.00, lon: 78.75, ndvi: 0.45, meanNDVI: 0.60, stdNDVI: 0.10, vsi: 58, stressLevel: 'moderate', ndviColor: ndviToColor(0.45) },
  { lat: 21.75, lon: 79.00, ndvi: 0.28, meanNDVI: 0.55, stdNDVI: 0.10, vsi: 82, stressLevel: 'high',     ndviColor: ndviToColor(0.28) },
  { lat: 21.50, lon: 79.25, ndvi: 0.15, meanNDVI: 0.50, stdNDVI: 0.10, vsi: 91, stressLevel: 'critical', ndviColor: ndviToColor(0.15) },
  { lat: 21.25, lon: 79.50, ndvi: 0.55, meanNDVI: 0.58, stdNDVI: 0.10, vsi: 18, stressLevel: 'none',     ndviColor: ndviToColor(0.55) },
  { lat: 21.00, lon: 79.75, ndvi: 0.38, meanNDVI: 0.52, stdNDVI: 0.10, vsi: 64, stressLevel: 'moderate', ndviColor: ndviToColor(0.38) },
  { lat: 20.75, lon: 80.00, ndvi: 0.70, meanNDVI: 0.68, stdNDVI: 0.09, vsi: 12, stressLevel: 'none',     ndviColor: ndviToColor(0.70) },
  { lat: 20.50, lon: 80.25, ndvi: 0.20, meanNDVI: 0.48, stdNDVI: 0.10, vsi: 88, stressLevel: 'critical', ndviColor: ndviToColor(0.20) },
];

// ── Helper: stress level styling ─────────────────────────────────────────────

const STRESS_STYLES: Record<StressLevel, { color: string; label: string; bg: string }> = {
  none:     { color: '#22c55e', label: 'Healthy',  bg: 'rgba(34,197,94,0.12)' },
  moderate: { color: '#eab308', label: 'Moderate', bg: 'rgba(234,179,8,0.12)' },
  high:     { color: '#f97316', label: 'High',     bg: 'rgba(249,115,22,0.12)' },
  critical: { color: '#ef4444', label: 'Critical', bg: 'rgba(239,68,68,0.12)' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** NDVI color scale legend (NASA GIBS palette) */
const NDVILegend: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: 'rgba(var(--fg-rgb),var(--fg-a6))' }}>
    <span>−1</span>
    <div
      aria-hidden="true"
      style={{
        flex: 1,
        height: 10,
        borderRadius: 5,
        background: 'linear-gradient(to right, rgb(70,130,180), rgb(210,180,140), rgb(210,210,80), rgb(80,170,40), rgb(0,80,10))',
      }}
    />
    <span>+1</span>
    <span style={{ marginLeft: 4, fontStyle: 'italic' }}>NDVI</span>
  </div>
);

/** VSI gauge bar */
const VSIBar: React.FC<{ vsi: VSIScore }> = ({ vsi }) => {
  const style = STRESS_STYLES[classifyStress(vsi)];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        role="progressbar"
        aria-valuenow={vsi}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`VSI ${vsi}`}
        style={{
          flex: 1,
          height: 8,
          background: 'rgba(var(--fg-rgb),var(--fg-a08))',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${vsi}%`,
            height: '100%',
            background: style.color,
            borderRadius: 4,
            transition: 'width 600ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: style.color, minWidth: 28, textAlign: 'right' }}>
        {vsi}
      </span>
    </div>
  );
};

interface AlertBadgeProps { level: StressLevel }
const AlertBadge: React.FC<AlertBadgeProps> = ({ level }) => {
  const { color, label, bg } = STRESS_STYLES[level];
  return (
    <span
      style={{
        background: bg,
        border: `1px solid ${color}`,
        borderRadius: 4,
        color,
        fontSize: 10,
        fontWeight: 700,
        padding: '1px 6px',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </span>
  );
};

/** Sparkline-style SVG for temporal NDVI profile (Req 57.4) */
const NDVIProfileChart: React.FC<{ profile: NDVIProfilePoint[] }> = ({ profile }) => {
  const W = 320;
  const H = 80;
  const pad = { left: 8, right: 8, top: 8, bottom: 18 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const toX = (i: number) => pad.left + (i / (profile.length - 1)) * innerW;
  const toY = (v: number) => pad.top + (1 - v) * innerH; // v in [0,1]

  const scaledCurrent = profile.map((p) => Math.max(0, Math.min(1, (p.currentYear + 0.1) / 1.0)));
  const scaledAvg     = profile.map((p) => Math.max(0, Math.min(1, (p.multiYearAvg  + 0.1) / 1.0)));

  const pathOf = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  // Shaded area for current-year
  const areaPath = [
    `M${toX(0).toFixed(1)},${(pad.top + innerH).toFixed(1)}`,
    ...scaledCurrent.map((v, i) => `L${toX(i).toFixed(1)},${toY(v).toFixed(1)}`),
    `L${toX(profile.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)}`,
    'Z',
  ].join(' ');

  return (
    <div aria-label="Temporal NDVI profile chart" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, fontSize: 10, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 2, background: '#22c55e', display: 'inline-block', borderRadius: 1 }} />
          Current Year
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 2, background: 'rgba(var(--fg-rgb),var(--fg-a4))', display: 'inline-block', borderRadius: 1, borderTop: '1px dashed rgba(var(--fg-rgb),var(--fg-a4))' }} />
          Multi-year Avg
        </span>
      </div>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', width: '100%', height: 'auto' }}
        aria-hidden="true"
      >
        {/* Grid line at NDVI = 0.3 (healthy vegetation threshold) */}
        <line
          x1={pad.left} y1={toY((0.3 + 0.1) / 1.0)} x2={W - pad.right} y2={toY((0.3 + 0.1) / 1.0)}
          stroke="rgba(34,197,94,0.2)" strokeWidth={1} strokeDasharray="3 3"
        />
        {/* Current-year shaded area */}
        <path d={areaPath} fill="rgba(34,197,94,0.08)" />
        {/* Multi-year average line */}
        <path d={pathOf(scaledAvg)} fill="none" stroke="rgba(var(--fg-rgb),var(--fg-a3))" strokeWidth={1.5} strokeDasharray="4 3" />
        {/* Current-year line */}
        <path d={pathOf(scaledCurrent)} fill="none" stroke="#22c55e" strokeWidth={2} />
        {/* Week labels — show every 4th */}
        {profile.map((p, i) =>
          i % 4 === 0 ? (
            <text key={p.week} x={toX(i)} y={H - 2} textAnchor="middle" fontSize={8} fill="rgba(var(--fg-rgb),var(--fg-a3))">
              {p.week}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
};

/** Single alert row */
const AlertRow: React.FC<{ alert: CropStressAlert; index: number }> = ({ alert, index }) => {
  const { color } = STRESS_STYLES[alert.stressLevel];
  return (
    <li
      style={{
        padding: '6px 8px',
        borderRadius: 6,
        background: index % 2 === 0 ? 'rgba(var(--fg-rgb),var(--fg-a05))' : 'transparent',
        borderLeft: `3px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertBadge level={alert.stressLevel} />
        <span style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
          {alert.lat.toFixed(2)}°N, {alert.lon.toFixed(2)}°E
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color }}>
          VSI {alert.vsi}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg-rgb),var(--fg-a7))', lineHeight: 1.35 }}>
        {alert.message}
      </p>
    </li>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface VegetationHealthProps {
  /** Grid cells for VSI computation; mock data used when absent or empty */
  gridCells?: GridCell[];
  /** Whether this panel is active */
  enabled?: boolean;
  /**
   * Pre-computed NDVI climatology keyed by "lat,lon" strings.
   * If not supplied, defaults of mean=0.35, std=0.12 are used.
   */
  ndviClimatology?: Map<string, { mean: NDVIValue; std: number }>;
  /** Real NDVI values from NASA GIBS keyed by "lat,lon" strings */
  ndviOverrides?: Map<string, NDVIValue>;
  /** Temporal NDVI profile for the selected cell; falls back to MOCK_NDVI_PROFILE */
  ndviProfile?: NDVIProfilePoint[];
  /**
   * Called when overlay data changes so the globe can render the NDVI layer.
   * Requirement 57.1.
   */
  onOverlayReady?: (cells: VegetationCell[]) => void;
  /**
   * Called whenever Crop Stress Alerts are generated.
   * Requirement 57.3.
   */
  onAlertsGenerated?: (alerts: CropStressAlert[]) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * VegetationHealth — NDVI monitoring and Vegetation Stress Index panel.
 *
 * Validates: Requirements 57.1, 57.2, 57.3, 57.4
 */
export const VegetationHealth: React.FC<VegetationHealthProps> = ({
  gridCells,
  enabled = true,
  ndviClimatology = new Map(),
  ndviOverrides   = new Map(),
  ndviProfile,
  onOverlayReady,
  onAlertsGenerated,
}) => {
  const [showAlerts,  setShowAlerts]  = useState(true);
  const [showProfile, setShowProfile] = useState(true);

  // Compute vegetation cells from real data or fall back to mock
  const vegCells = useMemo<VegetationCell[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return MOCK_VEGETATION_CELLS;
    const computed = computeVegetationCells(gridCells, ndviClimatology, ndviOverrides);
    return computed.length > 0 ? computed : MOCK_VEGETATION_CELLS;
  }, [gridCells, enabled, ndviClimatology, ndviOverrides]);

  // Notify globe of overlay data
  React.useEffect(() => {
    if (enabled && onOverlayReady && vegCells.length > 0) {
      onOverlayReady(vegCells);
    }
  }, [vegCells, enabled, onOverlayReady]);

  // Crop Stress Alerts
  const alerts = useMemo<CropStressAlert[]>(() => generateCropStressAlerts(vegCells), [vegCells]);

  React.useEffect(() => {
    if (enabled && onAlertsGenerated) {
      onAlertsGenerated(alerts);
    }
  }, [alerts, enabled, onAlertsGenerated]);

  // Summary statistics
  const stats = useMemo(() => {
    if (vegCells.length === 0) return { meanNDVI: 0, meanVSI: 0, healthyPct: 0 };
    const meanNDVI   = vegCells.reduce((s, c) => s + c.ndvi, 0) / vegCells.length;
    const meanVSI    = vegCells.reduce((s, c) => s + c.vsi,  0) / vegCells.length;
    const healthyPct = (vegCells.filter((c) => c.stressLevel === 'none').length / vegCells.length) * 100;
    return { meanNDVI, meanVSI: Math.round(meanVSI), healthyPct: Math.round(healthyPct) };
  }, [vegCells]);

  const profile = ndviProfile ?? MOCK_NDVI_PROFILE;

  if (!enabled) return null;

  return (
    <div
      className="vegetation-health"
      data-testid="vegetation-health"
      role="region"
      aria-label="Vegetation Health and NDVI"
    >
      {/* ── Critical Alert Banner ── */}
      {alerts.filter((a) => a.stressLevel === 'critical').length > 0 && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid #ef4444',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'veg-banner-pulse 2.5s ease-in-out infinite',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 18 }}>🌿</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fca5a5' }}>
            {alerts.filter((a) => a.stressLevel === 'critical').length} Critical Crop Stress Zone
            {alerts.filter((a) => a.stressLevel === 'critical').length > 1 ? 's' : ''} Detected
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            VSI &gt; {CROP_STRESS_ALERT_THRESHOLD}
          </span>
        </div>
      )}

      {/* ── Main GlassPanel ── */}
      <GlassPanel padding="md" className="veg-health-panel">
        <h3
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            margin: '0 0 12px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          🌱 Vegetation Health &amp; NDVI
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            {vegCells.length} cells
          </span>
        </h3>

        {/* NDVI legend */}
        <NDVILegend />

        {/* Summary KPIs */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            marginBottom: 12,
          }}
        >
          {[
            { label: 'Mean NDVI', value: stats.meanNDVI.toFixed(2), color: ndviToColor(stats.meanNDVI) },
            { label: 'Mean VSI',  value: String(stats.meanVSI),     color: STRESS_STYLES[classifyStress(stats.meanVSI)].color },
            { label: 'Healthy',   value: `${stats.healthyPct}%`,    color: '#22c55e' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                background: 'rgba(var(--fg-rgb),var(--fg-a05))',
                borderRadius: 6,
                padding: '8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: 10, color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* VSI distribution bar */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: 4 }}>
            VSI Distribution
          </div>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 1 }}>
            {(['none', 'moderate', 'high', 'critical'] as StressLevel[]).map((level) => {
              const count = vegCells.filter((c) => c.stressLevel === level).length;
              const pct   = vegCells.length > 0 ? (count / vegCells.length) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={level}
                  title={`${STRESS_STYLES[level].label}: ${Math.round(pct)}%`}
                  style={{ width: `${pct}%`, background: STRESS_STYLES[level].color, transition: 'width 600ms' }}
                />
              ) : null;
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            {(['none', 'moderate', 'high', 'critical'] as StressLevel[]).map((level) => {
              const count = vegCells.filter((c) => c.stressLevel === level).length;
              return (
                <span key={level} style={{ fontSize: 10, color: STRESS_STYLES[level].color }}>
                  {STRESS_STYLES[level].label} ({count})
                </span>
              );
            })}
          </div>
        </div>

        {/* ── Temporal NDVI Profile ── */}
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowProfile((v) => !v)}
            aria-expanded={showProfile}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'rgba(var(--fg-rgb),var(--fg-a75))',
              fontSize: 13,
              fontWeight: 600,
              marginBottom: showProfile ? 8 : 0,
            }}
          >
            <span aria-hidden="true">{showProfile ? '▾' : '▸'}</span>
            Seasonal NDVI Profile
            <span style={{ fontSize: 10, fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginLeft: 4 }}>
              current vs multi-year avg
            </span>
          </button>
          {showProfile && <NDVIProfileChart profile={profile} />}
        </div>

        {/* ── Crop Stress Alerts ── */}
        {alerts.length > 0 && (
          <div>
            <button
              onClick={() => setShowAlerts((v) => !v)}
              aria-expanded={showAlerts}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'rgba(var(--fg-rgb),var(--fg-a75))',
                fontSize: 13,
                fontWeight: 600,
                marginBottom: showAlerts ? 8 : 0,
              }}
            >
              <span aria-hidden="true">{showAlerts ? '▾' : '▸'}</span>
              Crop Stress Alerts
              <span
                style={{
                  background: 'rgba(239,68,68,0.2)',
                  border: '1px solid #ef4444',
                  borderRadius: 10,
                  color: '#fca5a5',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '0 6px',
                  marginLeft: 4,
                }}
              >
                {alerts.length}
              </span>
            </button>
            {showAlerts && (
              <ol
                aria-label="Crop stress alerts sorted by severity"
                style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}
              >
                {alerts.map((alert, i) => (
                  <AlertRow key={`${alert.lat},${alert.lon}`} alert={alert} index={i} />
                ))}
              </ol>
            )}
          </div>
        )}

        {alerts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '10px 0', color: '#22c55e', fontSize: 13, fontWeight: 500 }}>
            ✓ No crop stress alerts — vegetation is within normal range
          </div>
        )}
      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes veg-banner-pulse {
          0%, 100% { box-shadow: 0 0 5px rgba(239,68,68,0.25); }
          50%       { box-shadow: 0 0 16px rgba(239,68,68,0.6); }
        }
      `}</style>
    </div>
  );
};

export default VegetationHealth;
