/**
 * EnergyPanel — Solar/Wind Renewable Energy Potential.
 *
 * Exports pure functions (GHI computation, wind power density, capacity factors)
 * and a React component rendering the Renewable Energy Forecast panel.
 *
 * Physics references:
 *  • GHI ≈ (1 − 0.75 × n³) × I₀ × cos(θ_z)   [Bird & Hulstrom simplified]
 *    where n = cloud fraction [0,1], I₀ = 1361 W/m² (solar constant),
 *    θ_z ≈ mean solar zenith for India mid-latitude (~20° N) ≈ 28°
 *  • Wind power density P = ½ρV³  (ρ_air ≈ 1.225 kg/m³)
 *  • Hub-height wind via power law: V_hub = V_10m × (80/10)^α, α = 1/7
 *
 * Validates: Requirements 55.1, 55.2, 55.3, 55.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Solar constant (W/m²) */
export const SOLAR_CONSTANT_W_M2 = 1361;

/** Mean cosine of solar zenith for India (~20°N mid-latitude average) */
export const INDIA_MEAN_COS_ZENITH = Math.cos((28 * Math.PI) / 180); // ≈ 0.883

/** Air density at sea level (kg/m³) */
export const AIR_DENSITY_KG_M3 = 1.225;

/** Wind turbine hub height (m) */
export const HUB_HEIGHT_M = 80;

/** Reference wind measurement height (m) — standard 10 m */
export const WIND_REF_HEIGHT_M = 10;

/** Hellmann exponent (1/7 law) for wind profile */
export const WIND_HELLMANN_ALPHA = 1 / 7;

/** Typical commercial solar panel efficiency (%) used for capacity factor */
export const SOLAR_PANEL_EFFICIENCY = 0.2;

/** Rated irradiance at Standard Test Conditions (W/m²) */
export const STC_IRRADIANCE = 1000;

/** Wind turbine rated power density threshold (W/m²) — Vestas V90 class turbine */
export const WIND_RATED_POWER_DENSITY = 500;

/** Days in the 7-day forecast */
export const FORECAST_DAYS = 7;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Energy metrics computed per grid cell */
export interface EnergyCellResult {
  lat: number;
  lon: number;
  /** Global Horizontal Irradiance (W/m²) – Req 55.1 */
  ghi: number;
  /** Wind speed at hub height 80 m (m/s) – Req 55.2 */
  windSpeedHub: number;
  /** Wind power density at hub height (W/m²) – Req 55.2 */
  windPowerDensity: number;
  /** Solar capacity factor [0, 1] – Req 55.3 */
  solarCapacityFactor: number;
  /** Wind capacity factor [0, 1] – Req 55.3 */
  windCapacityFactor: number;
}

/** Daily generation estimate for a single day (Req 55.4) */
export interface DailyGenerationPoint {
  day: number;          // 1–7
  solarGWh: number;     // Normalised generation index (GWh / GW installed)
  windGWh: number;
}

/** Props for the energy panel */
export interface EnergyPanelProps {
  /** Per-day grid cells; key = forecast day (1–7) */
  forecastGrids?: Map<number, GridCell[]>;
  /** Currently selected forecast day (1–7) */
  selectedDay?: number;
  enabled?: boolean;
  onCellSelect?: (cell: EnergyCellResult) => void;
}

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Compute Global Horizontal Irradiance (GHI) from cloud cover fraction.
 *
 * Uses the Bird & Hulstrom simplified clear-sky model:
 *   GHI = (1 − 0.75 × n³) × I₀ × cos(θ_z)
 * where n is cloud fraction [0, 1].
 *
 * Returns a value in W/m² clamped to [0, SOLAR_CONSTANT_W_M2].
 *
 * @param cloudCoverFraction  Cloud cover in [0, 1] (0 = clear, 1 = overcast)
 * @param cosZenith           cos(solar zenith angle); defaults to India mean
 *
 * Validates: Requirement 55.1
 */
export function computeGHI(
  cloudCoverFraction: number,
  cosZenith: number = INDIA_MEAN_COS_ZENITH,
): number {
  const n = Math.max(0, Math.min(1, cloudCoverFraction));
  const clearSkyCorrectionFactor = 1 - 0.75 * Math.pow(n, 3);
  const ghi = clearSkyCorrectionFactor * SOLAR_CONSTANT_W_M2 * cosZenith;
  return Math.max(0, Math.min(SOLAR_CONSTANT_W_M2, ghi));
}

/**
 * Extrapolate wind speed from reference height to hub height using
 * the 1/7 power law (Hellmann exponent).
 *
 *   V_hub = V_ref × (h_hub / h_ref)^α
 *
 * @param windSpeedRef  Wind speed at reference height (m/s)
 * @param hubHeight     Hub height in metres (default 80 m)
 * @param refHeight     Reference measurement height in metres (default 10 m)
 * @param alpha         Hellmann exponent (default 1/7)
 *
 * Validates: Requirement 55.2
 */
export function extrapolateWindToHubHeight(
  windSpeedRef: number,
  hubHeight: number = HUB_HEIGHT_M,
  refHeight: number = WIND_REF_HEIGHT_M,
  alpha: number = WIND_HELLMANN_ALPHA,
): number {
  if (windSpeedRef < 0) return 0;
  return windSpeedRef * Math.pow(hubHeight / refHeight, alpha);
}

/**
 * Compute wind power density at a given wind speed.
 *
 *   P = ½ρV³  (W/m²)
 *
 * @param windSpeed   Wind speed (m/s)
 * @param airDensity  Air density (kg/m³); defaults to sea-level value
 *
 * Validates: Requirement 55.2
 */
export function computeWindPowerDensity(
  windSpeed: number,
  airDensity: number = AIR_DENSITY_KG_M3,
): number {
  if (windSpeed < 0) return 0;
  return 0.5 * airDensity * Math.pow(windSpeed, 3);
}

/**
 * Compute solar capacity factor for a grid cell.
 *
 * CF_solar = GHI / STC_irradiance × panel_efficiency
 * Clamped to [0, 1].
 *
 * @param ghi               GHI in W/m²
 * @param panelEfficiency   Panel efficiency [0, 1]; defaults to 20%
 * @param stcIrradiance     STC irradiance (W/m²); defaults to 1000 W/m²
 *
 * Validates: Requirement 55.3
 */
export function computeSolarCapacityFactor(
  ghi: number,
  panelEfficiency: number = SOLAR_PANEL_EFFICIENCY,
  stcIrradiance: number = STC_IRRADIANCE,
): number {
  const raw = (ghi / stcIrradiance) * panelEfficiency;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Compute wind capacity factor for a grid cell.
 *
 * Uses a simplified power curve:
 *   - CF = 0                         if V_hub < 3 m/s (cut-in)
 *   - CF = (P / P_rated)             if 3 ≤ V_hub ≤ 12 m/s (partial load)
 *   - CF = 1                         if 12 < V_hub ≤ 25 m/s (rated)
 *   - CF = 0                         if V_hub > 25 m/s (cut-out)
 *
 * @param windSpeedHub        Hub-height wind speed (m/s)
 * @param ratedPowerDensity   Rated power density (W/m²); defaults to 500 W/m²
 *
 * Validates: Requirement 55.3
 */
export function computeWindCapacityFactor(
  windSpeedHub: number,
  ratedPowerDensity: number = WIND_RATED_POWER_DENSITY,
): number {
  const CUT_IN = 3;
  const RATED = 12;
  const CUT_OUT = 25;

  if (windSpeedHub < CUT_IN || windSpeedHub > CUT_OUT) return 0;
  if (windSpeedHub >= RATED) return 1;

  const actualPower = computeWindPowerDensity(windSpeedHub);
  return Math.max(0, Math.min(1, actualPower / ratedPowerDensity));
}

/**
 * Derive cloud cover fraction from a GridCell.
 *
 * The VAYU model does not expose cloud cover directly; we approximate it
 * from rainfall and temperature:
 *   cloudFraction ≈ clamp(rainfall / 30, 0, 1) × 0.9 + temp_factor × 0.1
 * where temp_factor accounts for low max temps (cloud/rain days).
 *
 * In production this would be replaced with an explicit cloud cover field
 * from Open-Meteo or INSAT.
 *
 * @param cell  GridCell with rainfall and temp_max
 */
export function estimateCloudCoverFraction(cell: GridCell): number {
  // High rainfall → higher cloud cover
  const rainfallComponent = Math.min(1, cell.rainfall / 30);
  // Low max temp (below 25°C) suggests more cloudiness
  const tempComponent = Math.max(0, Math.min(1, (35 - cell.temp_max) / 20));
  return Math.max(0, Math.min(1, rainfallComponent * 0.85 + tempComponent * 0.15));
}

/**
 * Estimate 10 m wind speed from a GridCell.
 *
 * The VAYU model currently provides rainfall, temp_max, temp_min.
 * In production, wind speed would come from the Open-Meteo wind field.
 * For demo/fallback purposes we use a climatological estimate based on
 * temperature range (wider diurnal range → drier/windier conditions).
 *
 * @param cell  GridCell
 */
export function estimateWindSpeedMs(cell: GridCell): number {
  const diurnalRange = Math.max(0, cell.temp_max - cell.temp_min);
  // Typical India surface winds: 2–8 m/s; wider range → more convective → windier
  const base = 3.5;
  const windEstimate = base + (diurnalRange / 20) * 5;
  return Math.max(0, Math.min(20, windEstimate));
}

/**
 * Compute full energy metrics for a single grid cell.
 *
 * Validates: Requirements 55.1, 55.2, 55.3
 */
export function computeEnergyCellResult(cell: GridCell): EnergyCellResult {
  const cloudFraction = estimateCloudCoverFraction(cell);
  const ghi = computeGHI(cloudFraction);
  const windRef = estimateWindSpeedMs(cell);
  const windSpeedHub = extrapolateWindToHubHeight(windRef);
  const windPowerDensity = computeWindPowerDensity(windSpeedHub);
  const solarCapacityFactor = computeSolarCapacityFactor(ghi);
  const windCapacityFactor = computeWindCapacityFactor(windSpeedHub);

  return {
    lat: cell.lat,
    lon: cell.lon,
    ghi,
    windSpeedHub,
    windPowerDensity,
    solarCapacityFactor,
    windCapacityFactor,
  };
}

/**
 * Compute energy metrics for all cells in a forecast grid.
 *
 * Validates: Requirement 55.3
 */
export function computeEnergyGrid(cells: GridCell[]): EnergyCellResult[] {
  return cells.map(computeEnergyCellResult);
}

/**
 * Build daily generation curve data for the 7-day forecast period.
 *
 * Generation index (GWh / GW installed) = mean capacity factor × 24 h
 *
 * Validates: Requirement 55.4
 */
export function buildDailyGenerationCurve(
  forecastGrids: Map<number, GridCell[]>,
): DailyGenerationPoint[] {
  const points: DailyGenerationPoint[] = [];

  for (let day = 1; day <= FORECAST_DAYS; day++) {
    const cells = forecastGrids.get(day);
    if (!cells || cells.length === 0) {
      points.push({ day, solarGWh: 0, windGWh: 0 });
      continue;
    }

    const energyGrid = computeEnergyGrid(cells);
    const meanSolarCF =
      energyGrid.reduce((sum, c) => sum + c.solarCapacityFactor, 0) / energyGrid.length;
    const meanWindCF =
      energyGrid.reduce((sum, c) => sum + c.windCapacityFactor, 0) / energyGrid.length;

    // GWh / GW installed = CF × 24 h
    points.push({
      day,
      solarGWh: meanSolarCF * 24,
      windGWh: meanWindCF * 24,
    });
  }

  return points;
}

// ── Mock / Fallback Data ──────────────────────────────────────────────────────

/**
 * Mock 7-day generation curve used when no real forecast data is available.
 * Values are representative for a monsoon-season week in India.
 */
export const MOCK_GENERATION_CURVE: DailyGenerationPoint[] = [
  { day: 1, solarGWh: 3.8, windGWh: 8.2 },
  { day: 2, solarGWh: 4.5, windGWh: 7.6 },
  { day: 3, solarGWh: 2.9, windGWh: 9.1 },
  { day: 4, solarGWh: 3.2, windGWh: 8.8 },
  { day: 5, solarGWh: 4.8, windGWh: 7.2 },
  { day: 6, solarGWh: 5.1, windGWh: 6.9 },
  { day: 7, solarGWh: 4.2, windGWh: 7.5 },
];

// ── Color helpers ─────────────────────────────────────────────────────────────

/** Map solar capacity factor [0, 1] → CSS color (dark purple → bright yellow) */
export function solarCapacityColor(cf: number): string {
  const clamped = Math.max(0, Math.min(1, cf));
  const r = Math.round(30 + clamped * (255 - 30));
  const g = Math.round(10 + clamped * (200 - 10));
  const b = Math.round(80 - clamped * 80);
  return `rgb(${r},${g},${b})`;
}

/** Map wind capacity factor [0, 1] → CSS color (dark blue → bright cyan) */
export function windCapacityColor(cf: number): string {
  const clamped = Math.max(0, Math.min(1, cf));
  const r = Math.round(10 + clamped * 30);
  const g = Math.round(80 + clamped * (220 - 80));
  const b = Math.round(120 + clamped * (255 - 120));
  return `rgb(${r},${g},${b})`;
}

/** Human-readable solar potential category */
export function solarPotentialLabel(ghi: number): string {
  if (ghi < 200) return 'Poor';
  if (ghi < 400) return 'Moderate';
  if (ghi < 600) return 'Good';
  if (ghi < 800) return 'Excellent';
  return 'Outstanding';
}

/** Human-readable wind potential category */
export function windPotentialLabel(powerDensity: number): string {
  if (powerDensity < 100) return 'Poor';
  if (powerDensity < 200) return 'Marginal';
  if (powerDensity < 400) return 'Fair';
  if (powerDensity < 700) return 'Good';
  return 'Excellent';
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Single metric stat box */
const StatBox: React.FC<{ label: string; value: string; color: string; sub?: string }> = ({
  label, value, color, sub,
}) => (
  <div
    style={{
      background: `${color}14`,
      border: `1px solid ${color}50`,
      borderRadius: '8px',
      padding: '8px 10px',
      textAlign: 'center',
      flex: 1,
      minWidth: 0,
    }}
  >
    <div style={{ fontSize: '18px', fontWeight: 700, color }}>{value}</div>
    {sub && <div style={{ fontSize: '10px', color, opacity: 0.7, marginBottom: '2px' }}>{sub}</div>}
    <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginTop: '2px' }}>{label}</div>
  </div>
);

/** Capacity factor bar (horizontal progress-bar style) */
const CapacityBar: React.FC<{ label: string; value: number; color: string }> = ({
  label, value, color,
}) => (
  <div style={{ marginBottom: '6px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '11px' }}>
      <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a6))' }}>{label}</span>
      <span style={{ color, fontWeight: 600 }}>{(value * 100).toFixed(1)}%</span>
    </div>
    <div
      style={{
        height: '6px',
        borderRadius: '3px',
        background: 'rgba(var(--fg-rgb),var(--fg-a08))',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${value * 100}%`,
          background: `linear-gradient(to right, ${color}99, ${color})`,
          borderRadius: '3px',
          transition: 'width 600ms cubic-bezier(0.4,0,0.2,1)',
        }}
      />
    </div>
  </div>
);

/**
 * Sparkline generation chart rendered as an SVG polyline.
 * Req 55.4: render daily generation curves for the 7-day forecast.
 */
const GenerationChart: React.FC<{ curve: DailyGenerationPoint[]; selectedDay: number }> = ({
  curve,
  selectedDay,
}) => {
  const W = 280;
  const H = 80;
  const PAD = { top: 8, right: 12, bottom: 20, left: 32 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxSolar = Math.max(...curve.map((p) => p.solarGWh), 0.01);
  const maxWind  = Math.max(...curve.map((p) => p.windGWh),  0.01);
  const maxVal   = Math.max(maxSolar, maxWind);

  const toX = (day: number) => PAD.left + ((day - 1) / (FORECAST_DAYS - 1)) * innerW;
  const toY = (val: number) => PAD.top + innerH - (val / maxVal) * innerH;

  const polylinePts = (getter: (p: DailyGenerationPoint) => number) =>
    curve.map((p) => `${toX(p.day)},${toY(getter(p))}`).join(' ');

  const solarPts = polylinePts((p) => p.solarGWh);
  const windPts  = polylinePts((p) => p.windGWh);

  // Selected-day vertical marker
  const selX = toX(selectedDay);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      aria-label="7-day renewable energy generation forecast"
      role="img"
      style={{ width: '100%', height: '80px', overflow: 'visible' }}
    >
      {/* Gridlines */}
      {[0, 0.5, 1].map((t) => {
        const y = PAD.top + innerH - t * innerH;
        return (
          <line
            key={t}
            x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y}
            stroke="rgba(var(--fg-rgb),var(--fg-a08))" strokeWidth="1"
          />
        );
      })}

      {/* Day labels */}
      {curve.map((p) => (
        <text
          key={p.day}
          x={toX(p.day)} y={H - 4}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(var(--fg-rgb),var(--fg-a3))"
        >
          D{p.day}
        </text>
      ))}

      {/* Y-axis label */}
      <text
        x={PAD.left - 2} y={PAD.top + innerH / 2}
        textAnchor="middle"
        fontSize="8"
        fill="rgba(var(--fg-rgb),var(--fg-a3))"
        transform={`rotate(-90, ${PAD.left - 14}, ${PAD.top + innerH / 2})`}
      >
        GWh/GW
      </text>

      {/* Wind line */}
      <polyline
        points={windPts}
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1.5"
        strokeLinejoin="round"
        opacity={0.85}
      />

      {/* Solar line */}
      <polyline
        points={solarPts}
        fill="none"
        stroke="#fbbf24"
        strokeWidth="1.5"
        strokeLinejoin="round"
        opacity={0.85}
      />

      {/* Selected day marker */}
      <line
        x1={selX} y1={PAD.top} x2={selX} y2={PAD.top + innerH}
        stroke="rgba(var(--fg-rgb),var(--fg-a3))" strokeWidth="1" strokeDasharray="3 2"
      />

      {/* Data point dots */}
      {curve.map((p) => (
        <g key={p.day}>
          <circle cx={toX(p.day)} cy={toY(p.solarGWh)} r={p.day === selectedDay ? 3 : 2}
            fill="#fbbf24" opacity={p.day === selectedDay ? 1 : 0.6} />
          <circle cx={toX(p.day)} cy={toY(p.windGWh)} r={p.day === selectedDay ? 3 : 2}
            fill="#22d3ee" opacity={p.day === selectedDay ? 1 : 0.6} />
        </g>
      ))}
    </svg>
  );
};

/** Legend row with color swatch */
const LegendRow: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
    <span style={{ width: '16px', height: '3px', background: color, borderRadius: '2px', display: 'inline-block' }} />
    {label}
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * EnergyPanel — Renewable Energy Forecast Panel.
 *
 * Displays:
 *  1. Regional solar (GHI, capacity factor) and wind (power density, CF) summaries
 *  2. 7-day generation curve chart
 *  3. Per-metric capacity-factor bars for the selected day
 *
 * Validates: Requirements 55.1, 55.2, 55.3, 55.4
 */
export const EnergyPanel: React.FC<EnergyPanelProps> = ({
  forecastGrids,
  selectedDay = 1,
  enabled = true,
  onCellSelect,
}) => {
  const [activeTab, setActiveTab] = useState<'solar' | 'wind' | 'forecast'>('forecast');

  // Compute energy grid for the selected day
  const energyGrid = useMemo<EnergyCellResult[]>(() => {
    if (!forecastGrids) return [];
    const cells = forecastGrids.get(selectedDay);
    if (!cells || cells.length === 0) return [];
    return computeEnergyGrid(cells);
  }, [forecastGrids, selectedDay]);

  // Regional averages
  const regionStats = useMemo(() => {
    if (energyGrid.length === 0) return null;
    const n = energyGrid.length;
    const avgGHI         = energyGrid.reduce((s, c) => s + c.ghi, 0) / n;
    const avgWindPD      = energyGrid.reduce((s, c) => s + c.windPowerDensity, 0) / n;
    const avgSolarCF     = energyGrid.reduce((s, c) => s + c.solarCapacityFactor, 0) / n;
    const avgWindCF      = energyGrid.reduce((s, c) => s + c.windCapacityFactor, 0) / n;
    const maxGHICell     = energyGrid.reduce((best, c) => c.ghi > best.ghi ? c : best, energyGrid[0]);
    const maxWindCell    = energyGrid.reduce((best, c) => c.windPowerDensity > best.windPowerDensity ? c : best, energyGrid[0]);
    return { avgGHI, avgWindPD, avgSolarCF, avgWindCF, maxGHICell, maxWindCell };
  }, [energyGrid]);

  // 7-day generation curve
  const generationCurve = useMemo<DailyGenerationPoint[]>(() => {
    if (!forecastGrids || forecastGrids.size === 0) return MOCK_GENERATION_CURVE;
    const curve = buildDailyGenerationCurve(forecastGrids);
    // If all zeros (no real data), fall back to mock
    const anyNonZero = curve.some((p) => p.solarGWh > 0 || p.windGWh > 0);
    return anyNonZero ? curve : MOCK_GENERATION_CURVE;
  }, [forecastGrids]);

  // Selected day point
  const selectedPoint = generationCurve.find((p) => p.day === selectedDay) ?? generationCurve[0];

  if (!enabled) return null;

  // Use mock stats for display when no real grid provided
  const displayStats = regionStats ?? {
    avgGHI: 520,
    avgWindPD: 230,
    avgSolarCF: 0.18,
    avgWindCF: 0.34,
    maxGHICell: null,
    maxWindCell: null,
  };

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: active ? 600 : 400,
    color: active ? '#fff' : 'rgba(var(--fg-rgb),var(--fg-a4))',
    background: active ? 'rgba(var(--fg-rgb),var(--fg-a1))' : 'transparent',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    transition: 'all 200ms ease',
  });

  return (
    <div
      className="energy-panel"
      data-testid="energy-panel"
      role="region"
      aria-label="Renewable Energy Forecast Panel"
    >
      <GlassPanel padding="md" className="energy-panel__inner">
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
          <h3 style={{
            fontSize: '15px',
            fontWeight: 600,
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            ⚡ Renewable Energy Forecast
          </h3>
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
            Day {selectedDay} of {FORECAST_DAYS}
          </span>
        </div>

        {/* ── Summary stat boxes ── */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          <StatBox
            label="Mean GHI"
            value={`${displayStats.avgGHI.toFixed(0)}`}
            sub="W/m²"
            color="#fbbf24"
          />
          <StatBox
            label="Wind PD"
            value={`${displayStats.avgWindPD.toFixed(0)}`}
            sub="W/m²"
            color="#22d3ee"
          />
          <StatBox
            label="Solar CF"
            value={`${(displayStats.avgSolarCF * 100).toFixed(1)}%`}
            color="#f59e0b"
          />
          <StatBox
            label="Wind CF"
            value={`${(displayStats.avgWindCF * 100).toFixed(1)}%`}
            color="#06b6d4"
          />
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
          {(['forecast', 'solar', 'wind'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={TAB_STYLE(activeTab === tab)}
              aria-pressed={activeTab === tab}
            >
              {tab === 'forecast' ? '📈 7-Day' : tab === 'solar' ? '☀️ Solar' : '💨 Wind'}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}

        {activeTab === 'forecast' && (
          <div>
            {/* Generation curve chart */}
            <GenerationChart curve={generationCurve} selectedDay={selectedDay} />
            <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '4px' }}>
              <LegendRow color="#fbbf24" label="Solar (GWh/GW)" />
              <LegendRow color="#22d3ee" label="Wind (GWh/GW)" />
            </div>
            {/* Selected day detail */}
            {selectedPoint && (
              <div style={{
                marginTop: '8px',
                background: 'rgba(var(--fg-rgb),var(--fg-a05))',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '11px',
                display: 'flex',
                justifyContent: 'space-between',
              }}>
                <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>Day {selectedPoint.day}</span>
                <span style={{ color: '#fbbf24' }}>☀️ {selectedPoint.solarGWh.toFixed(2)} GWh/GW</span>
                <span style={{ color: '#22d3ee' }}>💨 {selectedPoint.windGWh.toFixed(2)} GWh/GW</span>
              </div>
            )}
          </div>
        )}

        {activeTab === 'solar' && (
          <div>
            <CapacityBar label="Solar Capacity Factor" value={displayStats.avgSolarCF} color="#fbbf24" />
            <div style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '8px' }}>
              Mean GHI: <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                {displayStats.avgGHI.toFixed(0)} W/m²
              </span>
              &nbsp;·&nbsp;
              Potential: <span style={{ color: '#fbbf24' }}>
                {solarPotentialLabel(displayStats.avgGHI)}
              </span>
            </div>

            {/* GHI color scale legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
              <span>0</span>
              <div style={{
                flex: 1, height: '8px', borderRadius: '4px',
                background: 'linear-gradient(to right, rgb(30,10,80), rgb(200,100,0), rgb(255,220,0))',
              }} />
              <span>1200 W/m²</span>
            </div>
            <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginTop: '4px' }}>
              GHI = (1 − 0.75n³) × I₀ × cos(θz) · n = cloud fraction
            </div>
          </div>
        )}

        {activeTab === 'wind' && (
          <div>
            <CapacityBar label="Wind Capacity Factor" value={displayStats.avgWindCF} color="#22d3ee" />
            <div style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '8px' }}>
              Mean power density: <span style={{ color: '#22d3ee', fontWeight: 600 }}>
                {displayStats.avgWindPD.toFixed(0)} W/m²
              </span>
              &nbsp;·&nbsp;
              Potential: <span style={{ color: '#22d3ee' }}>
                {windPotentialLabel(displayStats.avgWindPD)}
              </span>
            </div>

            {/* Wind power density color scale legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
              <span>0</span>
              <div style={{
                flex: 1, height: '8px', borderRadius: '4px',
                background: 'linear-gradient(to right, rgb(10,30,80), rgb(0,150,200), rgb(0,255,255))',
              }} />
              <span>700+ W/m²</span>
            </div>
            <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginTop: '4px' }}>
              P = ½ρV³ at 80 m hub height · cut-in 3 m/s · rated 12 m/s
            </div>
          </div>
        )}

      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes energy-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        .energy-panel__inner .glass-panel {
          animation: none;
        }
      `}</style>
    </div>
  );
};

export default EnergyPanel;
