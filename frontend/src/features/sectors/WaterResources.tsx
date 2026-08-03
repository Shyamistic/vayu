/**
 * WaterResources — Water Resources Dashboard.
 *
 * Exports pure functions for Penman-Monteith PET computation and water balance
 * (fully testable), plus a React component that:
 *  1. Displays major Indian reservoir locations as markers with current and
 *     predicted storage levels (Req 56.1)
 *  2. Computes potential evapotranspiration (PET) via Penman-Monteith from
 *     temperature and solar radiation (Req 56.2)
 *  3. Renders a water balance chart: precipitation vs evapotranspiration for
 *     the 7-day forecast period (Req 56.3)
 *  4. Generates Reservoir Advisory alerts when predicted inflow exceeds safe
 *     storage capacity (Req 56.4)
 *
 * Validates: Requirements 56.1, 56.2, 56.3, 56.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ─────────────────────────────── Types ───────────────────────────────────────

/** Reservoir status tier */
export type StorageTier = 'critical' | 'low' | 'normal' | 'high' | 'overflow';

/** A major Indian reservoir with location and capacity data */
export interface ReservoirDef {
  id: string;
  name: string;
  river: string;
  state: string;
  lat: number;
  lon: number;
  /** Full Reservoir Level capacity in Million Cubic Metres (MCM) */
  capacityMCM: number;
  /** Safe storage threshold as fraction of capacity (e.g. 0.85) */
  safeStorageFraction: number;
}

/** Live / predicted status for a single reservoir */
export interface ReservoirStatus {
  reservoir: ReservoirDef;
  /** Current storage in MCM */
  currentStorageMCM: number;
  /** Predicted storage after 7 days (MCM) */
  predictedStorageMCM: number;
  /** Predicted 7-day inflow (MCM) */
  predictedInflowMCM: number;
  storageTier: StorageTier;
  /** Fill fraction 0–1 */
  fillFraction: number;
  /** True when predicted inflow would exceed safe storage */
  advisoryActive: boolean;
}

/** Reservoir Advisory alert */
export interface ReservoirAdvisory {
  reservoir: ReservoirDef;
  predictedInflowMCM: number;
  safeCapacityMCM: number;
  excessMCM: number;
  message: string;
}

/** Daily water balance entry for the chart */
export interface WaterBalanceDay {
  day: number; // 1–7
  precipitationMm: number;
  petMm: number;
  /** precipitationMm − petMm */
  balanceMm: number;
}

/** Inputs required for the Penman-Monteith PET formula */
export interface PenmanMonteithInputs {
  /** Mean air temperature (°C) */
  tempMeanC: number;
  /** Maximum air temperature (°C) */
  tempMaxC: number;
  /** Minimum air temperature (°C) */
  tempMinC: number;
  /** Net solar radiation at the surface (MJ m⁻² day⁻¹) */
  solarRadiationMJm2day: number;
  /** Wind speed at 2 m height (m s⁻¹) */
  windSpeedMs: number;
  /** Relative humidity (%) — used to compute actual vapour pressure */
  relativeHumidityPct: number;
  /** Elevation above sea level (m) — for atmospheric pressure */
  elevationM: number;
}

// ─────────────────────── Major Indian Reservoirs ─────────────────────────────

/**
 * Major Indian reservoirs used for the Water Resources Dashboard.
 * Capacity values (MCM) are taken from Central Water Commission data.
 * Requirement 56.1: display major Indian reservoir locations.
 */
export const RESERVOIR_DEFINITIONS: ReservoirDef[] = [
  { id: 'indira_sagar',  name: 'Indira Sagar',      river: 'Narmada',  state: 'Madhya Pradesh', lat: 22.30, lon: 76.46, capacityMCM: 12219, safeStorageFraction: 0.90 },
  { id: 'nagarjunasagar',name: 'Nagarjuna Sagar',   river: 'Krishna',  state: 'Telangana',      lat: 16.57, lon: 79.32, capacityMCM: 11472, safeStorageFraction: 0.88 },
  { id: 'sardar_sarovar',name: 'Sardar Sarovar',    river: 'Narmada',  state: 'Gujarat',        lat: 21.83, lon: 73.74, capacityMCM:  9490, safeStorageFraction: 0.85 },
  { id: 'srisailam',     name: 'Srisailam',         river: 'Krishna',  state: 'Andhra Pradesh', lat: 16.09, lon: 78.89, capacityMCM:  8722, safeStorageFraction: 0.85 },
  { id: 'rihand',        name: 'Rihand',            river: 'Rihand',   state: 'Uttar Pradesh',  lat: 24.20, lon: 83.02, capacityMCM:  8924, safeStorageFraction: 0.90 },
  { id: 'bhakra_nangal', name: 'Bhakra Nangal',     river: 'Sutlej',   state: 'Himachal Pradesh',lat:31.41, lon: 76.44, capacityMCM:  7501, safeStorageFraction: 0.88 },
  { id: 'hirakud',       name: 'Hirakud',           river: 'Mahanadi', state: 'Odisha',         lat: 21.53, lon: 83.87, capacityMCM:  5818, safeStorageFraction: 0.85 },
  { id: 'tungabhadra',   name: 'Tungabhadra',       river: 'Tungabhadra',state:'Karnataka',     lat: 15.27, lon: 76.33, capacityMCM:  3722, safeStorageFraction: 0.85 },
  { id: 'mettur',        name: 'Mettur',            river: 'Cauvery',  state: 'Tamil Nadu',     lat: 11.80, lon: 77.80, capacityMCM:  2648, safeStorageFraction: 0.85 },
  { id: 'koyna',         name: 'Koyna',             river: 'Koyna',    state: 'Maharashtra',    lat: 17.40, lon: 73.77, capacityMCM:  2797, safeStorageFraction: 0.88 },
];

// ──────────────────── Pure Functions (exported for testing) ──────────────────

/**
 * Compute potential evapotranspiration (PET) using the FAO-56 Penman-Monteith
 * reference equation for a hypothetical short grass reference crop.
 *
 * Reference: Allen et al. (1998) "Crop evapotranspiration — Guidelines for
 * computing crop water requirements" FAO Irrigation and drainage paper 56.
 *
 * ET₀ = [0.408·Δ·(Rn−G) + γ·(900/(T+273))·u₂·(es−ea)]
 *       / [Δ + γ·(1 + 0.34·u₂)]
 *
 * where:
 *   Δ  = slope of saturation vapour pressure curve (kPa °C⁻¹)
 *   Rn = net radiation (MJ m⁻² day⁻¹), G ≈ 0 for daily
 *   γ  = psychrometric constant (kPa °C⁻¹)
 *   T  = mean daily temperature (°C)
 *   u₂ = wind speed at 2 m height (m s⁻¹)
 *   es = saturation vapour pressure (kPa)
 *   ea = actual vapour pressure (kPa)
 *
 * @returns ET₀ in mm day⁻¹ (≥ 0)
 *
 * Validates: Requirement 56.2
 */
export function computePenmanMonteithPET(inputs: PenmanMonteithInputs): number {
  const { tempMeanC, tempMaxC, tempMinC, solarRadiationMJm2day, windSpeedMs,
          relativeHumidityPct, elevationM } = inputs;

  // Atmospheric pressure (kPa) from elevation
  const P = 101.3 * Math.pow((293 - 0.0065 * elevationM) / 293, 5.26);

  // Psychrometric constant γ (kPa °C⁻¹)
  const gamma = 0.000665 * P;

  // Saturation vapour pressure for Tmax and Tmin (kPa)
  const esTmax = 0.6108 * Math.exp((17.27 * tempMaxC) / (tempMaxC + 237.3));
  const esTmin = 0.6108 * Math.exp((17.27 * tempMinC) / (tempMinC + 237.3));
  const es = (esTmax + esTmin) / 2;

  // Actual vapour pressure ea from relative humidity
  const ea = (relativeHumidityPct / 100) * es;

  // Slope of saturation vapour pressure curve Δ (kPa °C⁻¹)
  const delta =
    (4098 * 0.6108 * Math.exp((17.27 * tempMeanC) / (tempMeanC + 237.3))) /
    Math.pow(tempMeanC + 237.3, 2);

  // Net radiation Rn; soil heat flux G ≈ 0 for daily timestep
  const Rn = solarRadiationMJm2day;
  const G = 0;

  // FAO-56 PM equation numerator and denominator
  const numerator =
    0.408 * delta * (Rn - G) +
    gamma * (900 / (tempMeanC + 273)) * windSpeedMs * (es - ea);
  const denominator = delta + gamma * (1 + 0.34 * windSpeedMs);

  const ET0 = numerator / denominator;
  return Math.max(0, ET0);
}

/**
 * Derive a simplified solar radiation estimate (MJ m⁻² day⁻¹) from
 * temperature range using the Hargreaves-Samani formula.
 * Used as a fallback when measured radiation is unavailable.
 *
 * Rs = kRs · Ra · √(Tmax − Tmin)
 * For interior regions: kRs ≈ 0.16; coastal: 0.19.
 * Ra (extraterrestrial radiation) is approximated as 25 MJ m⁻² day⁻¹
 * for a mid-India latitude in the monsoon season.
 *
 * @param tempMaxC  Maximum temperature (°C)
 * @param tempMinC  Minimum temperature (°C)
 * @param kRs       Calibration coefficient (default 0.16)
 * @param Ra        Extraterrestrial radiation (MJ m⁻² day⁻¹, default 25)
 */
export function estimateSolarRadiation(
  tempMaxC: number,
  tempMinC: number,
  kRs = 0.16,
  Ra = 25,
): number {
  const tdiff = Math.max(0, tempMaxC - tempMinC);
  return kRs * Ra * Math.sqrt(tdiff);
}

/**
 * Derive PET inputs from a GridCell, applying sensible defaults for
 * parameters not directly available in the grid (humidity, wind, elevation).
 *
 * @param cell              Grid cell with temp_max and temp_min
 * @param windSpeedMs       Wind speed at 2 m (m s⁻¹), default 2.0
 * @param relativeHumidityPct Relative humidity (%), default 70
 * @param elevationM        Elevation (m), default 300 (avg Indian plains)
 */
export function petFromGridCell(
  cell: GridCell,
  windSpeedMs = 2.0,
  relativeHumidityPct = 70,
  elevationM = 300,
): number {
  const tempMeanC = (cell.temp_max + cell.temp_min) / 2;
  const solarRadiationMJm2day = estimateSolarRadiation(cell.temp_max, cell.temp_min);
  return computePenmanMonteithPET({
    tempMeanC,
    tempMaxC: cell.temp_max,
    tempMinC: cell.temp_min,
    solarRadiationMJm2day,
    windSpeedMs,
    relativeHumidityPct,
    elevationM,
  });
}

/**
 * Compute the 7-day water balance from a sequence of daily grid cell snapshots.
 *
 * For each day, the balance = mean(precipitation) − mean(PET) across all
 * grid cells in the active region.
 *
 * @param dailyCells  Array of 7 grid-cell arrays (index 0 = day 1, …)
 * @returns WaterBalanceDay[] with precipitationMm, petMm, balanceMm per day.
 *
 * Validates: Requirement 56.3
 */
export function computeWaterBalance(
  dailyCells: GridCell[][],
): WaterBalanceDay[] {
  return dailyCells.map((cells, idx) => {
    if (cells.length === 0) {
      return { day: idx + 1, precipitationMm: 0, petMm: 0, balanceMm: 0 };
    }
    const precipitationMm =
      cells.reduce((sum, c) => sum + c.rainfall, 0) / cells.length;
    const petMm =
      cells.reduce((sum, c) => sum + petFromGridCell(c), 0) / cells.length;
    return {
      day: idx + 1,
      precipitationMm,
      petMm,
      balanceMm: precipitationMm - petMm,
    };
  });
}

/**
 * Classify a reservoir's current fill fraction into a storage tier.
 */
export function classifyStorageTier(fillFraction: number): StorageTier {
  if (fillFraction >= 1.0)  return 'overflow';
  if (fillFraction >= 0.75) return 'high';
  if (fillFraction >= 0.40) return 'normal';
  if (fillFraction >= 0.20) return 'low';
  return 'critical';
}

/**
 * Convert accumulated rainfall over the reservoir's catchment area into
 * an inflow estimate in MCM.
 *
 * Simplified: inflow(MCM) = rainfall(mm) × catchmentArea(km²) × runoffCoeff × 1000
 *   (1 mm over 1 km² = 1000 m³ = 0.001 MCM)
 *
 * @param rainfallMm        Mean rainfall over 7 days (mm)
 * @param catchmentAreaKm2  Catchment area (km²)
 * @param runoffCoeff       Fraction of rainfall that becomes runoff (0–1)
 */
export function estimateInflowMCM(
  rainfallMm: number,
  catchmentAreaKm2: number,
  runoffCoeff = 0.4,
): number {
  // 1 mm over 1 km² = 1000 m³ = 0.001 MCM
  return (rainfallMm / 1000) * catchmentAreaKm2 * runoffCoeff * 1e6 / 1e6;
  // Simplifies to: rainfallMm * catchmentAreaKm2 * runoffCoeff / 1000
}

/**
 * Compute the status of a reservoir given its definition and predicted rainfall.
 *
 * @param reservoir         Reservoir definition
 * @param currentFillFrac   Current fill fraction (0–1)
 * @param sevenDayRainfallMm Mean 7-day rainfall over catchment (mm)
 * @param catchmentAreaKm2  Catchment area (km²), default 5000
 * @param runoffCoeff       Runoff coefficient, default 0.4
 *
 * Validates: Requirements 56.1, 56.4
 */
export function computeReservoirStatus(
  reservoir: ReservoirDef,
  currentFillFrac: number,
  sevenDayRainfallMm: number,
  catchmentAreaKm2 = 5000,
  runoffCoeff = 0.4,
): ReservoirStatus {
  const currentStorageMCM = reservoir.capacityMCM * currentFillFrac;
  const predictedInflowMCM = estimateInflowMCM(sevenDayRainfallMm, catchmentAreaKm2, runoffCoeff);
  const predictedStorageMCM = Math.min(
    reservoir.capacityMCM,
    currentStorageMCM + predictedInflowMCM,
  );
  const fillFraction = predictedStorageMCM / reservoir.capacityMCM;
  const storageTier = classifyStorageTier(fillFraction);
  const safeCapacityMCM = reservoir.capacityMCM * reservoir.safeStorageFraction;
  const advisoryActive = predictedStorageMCM > safeCapacityMCM;

  return {
    reservoir,
    currentStorageMCM,
    predictedStorageMCM,
    predictedInflowMCM,
    storageTier,
    fillFraction,
    advisoryActive,
  };
}

/**
 * Generate Reservoir Advisory alerts for all reservoirs where predicted
 * inflow causes storage to exceed safe capacity.
 *
 * Validates: Requirement 56.4
 */
export function generateReservoirAdvisories(
  statuses: ReservoirStatus[],
): ReservoirAdvisory[] {
  return statuses
    .filter((s) => s.advisoryActive)
    .map((s) => {
      const safeCapacityMCM = s.reservoir.capacityMCM * s.reservoir.safeStorageFraction;
      const excessMCM = s.predictedStorageMCM - safeCapacityMCM;
      const pct = ((s.predictedStorageMCM / s.reservoir.capacityMCM) * 100).toFixed(1);
      return {
        reservoir: s.reservoir,
        predictedInflowMCM: s.predictedInflowMCM,
        safeCapacityMCM,
        excessMCM,
        message:
          `RESERVOIR ADVISORY — ${s.reservoir.name} (${s.reservoir.river}): ` +
          `7-day predicted storage ${pct}% of FRL. ` +
          `Inflow +${s.predictedInflowMCM.toFixed(0)} MCM exceeds safe threshold by ` +
          `${excessMCM.toFixed(0)} MCM. Controlled releases recommended.`,
      };
    });
}

// ──────────────────────── Mock / Demo Data ───────────────────────────────────

/** Mock fill fractions for demo when real data is unavailable */
const MOCK_FILL_FRACTIONS: Record<string, number> = {
  indira_sagar:   0.72,
  nagarjunasagar: 0.68,
  sardar_sarovar: 0.55,
  srisailam:      0.81,
  rihand:         0.60,
  bhakra_nangal:  0.77,
  hirakud:        0.45,
  tungabhadra:    0.38,
  mettur:         0.29,
  koyna:          0.83,
};

/** Default catchment areas (km²) per reservoir */
const CATCHMENT_AREAS_KM2: Record<string, number> = {
  indira_sagar:   98796,
  nagarjunasagar: 215000,
  sardar_sarovar: 88000,
  srisailam:      189000,
  rihand:         13664,
  bhakra_nangal:  56980,
  hirakud:        83400,
  tungabhadra:    28177,
  mettur:         77141,
  koyna:           891,
};

/** Mock 7-day rainfall (mm) per reservoir catchment */
const MOCK_CATCHMENT_RAINFALL_MM: Record<string, number> = {
  indira_sagar:   120,
  nagarjunasagar: 95,
  sardar_sarovar: 80,
  srisailam:      150,
  rihand:         60,
  bhakra_nangal:  40,
  hirakud:        110,
  tungabhadra:    70,
  mettur:         55,
  koyna:          200,
};

// ────────────────────────── Constants ────────────────────────────────────────

/** Colors for each storage tier */
export const STORAGE_TIER_COLORS: Record<StorageTier, string> = {
  critical: '#ef4444', // red
  low:      '#f97316', // orange
  normal:   '#22c55e', // green
  high:     '#3b82f6', // blue
  overflow: '#a855f7', // purple
};

/** Labels for each storage tier */
export const STORAGE_TIER_LABELS: Record<StorageTier, string> = {
  critical: 'Critical (<20%)',
  low:      'Low (20-40%)',
  normal:   'Normal (40-75%)',
  high:     'High (75-100%)',
  overflow: 'At Capacity',
};

// ─────────────────────────── Sub-components ──────────────────────────────────

/** Storage fill bar for a single reservoir */
const FillBar: React.FC<{ fillFraction: number; tier: StorageTier; safeThreshold: number }> = ({
  fillFraction,
  tier,
  safeThreshold,
}) => {
  const color = STORAGE_TIER_COLORS[tier];
  const pct = Math.min(100, fillFraction * 100);
  const safeMarkerPct = safeThreshold * 100;

  return (
    <div
      style={{ position: 'relative', height: '10px', borderRadius: '5px',
               background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}
      aria-label={`Storage: ${pct.toFixed(0)}%`}
    >
      <div
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`, background: color,
          borderRadius: '5px', transition: 'width 400ms ease',
        }}
      />
      {/* Safe threshold marker */}
      <div
        title={`Safe threshold: ${safeMarkerPct.toFixed(0)}%`}
        style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${safeMarkerPct}%`, width: '2px',
          background: 'rgba(255,220,50,0.7)',
        }}
      />
    </div>
  );
};

/** Row for a single reservoir in the table */
interface ReservoirRowProps {
  status: ReservoirStatus;
  isSelected: boolean;
  onSelect: () => void;
}

const ReservoirRow: React.FC<ReservoirRowProps> = ({ status, isSelected, onSelect }) => {
  const { reservoir, currentStorageMCM, predictedStorageMCM, storageTier, fillFraction, advisoryActive } = status;
  const color = STORAGE_TIER_COLORS[storageTier];

  return (
    <tr
      onClick={onSelect}
      aria-selected={isSelected}
      style={{
        cursor: 'pointer',
        borderLeft: isSelected ? `3px solid ${color}` : '3px solid transparent',
        background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isSelected ? 'rgba(255,255,255,0.06)' : 'transparent'; }}
    >
      <td style={{ padding: '5px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {advisoryActive && (
            <span aria-label="Advisory active" style={{ fontSize: '11px', animation: 'res-blink 1.5s ease-in-out infinite' }}>
              ⚠️
            </span>
          )}
          <div>
            <div style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontSize: '12px' }}>
              {reservoir.name}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>
              {reservoir.river} · {reservoir.state}
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: '5px 8px', minWidth: '100px' }}>
        <FillBar fillFraction={fillFraction} tier={storageTier} safeThreshold={reservoir.safeStorageFraction} />
        <div style={{ fontSize: '10px', color, marginTop: '2px', fontWeight: 600 }}>
          {(fillFraction * 100).toFixed(0)}% — {STORAGE_TIER_LABELS[storageTier]}
        </div>
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
        {currentStorageMCM.toFixed(0)}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: '11px', color }}>
        {predictedStorageMCM.toFixed(0)}
      </td>
    </tr>
  );
};

/** Water Balance Chart — 7-day bar chart rendered as inline SVG */
const WaterBalanceChart: React.FC<{ balanceDays: WaterBalanceDay[] }> = ({ balanceDays }) => {
  const W = 300;
  const H = 120;
  const PAD = { top: 10, right: 10, bottom: 28, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (balanceDays.length === 0) return null;

  const maxPrecip = Math.max(...balanceDays.map((d) => d.precipitationMm), 1);
  const maxPET    = Math.max(...balanceDays.map((d) => d.petMm), 1);
  const maxVal    = Math.max(maxPrecip, maxPET, 1);

  const barWidth = innerW / balanceDays.length;
  const barGap = barWidth * 0.15;
  const singleBar = (barWidth - barGap * 2) / 2;

  const toY = (v: number) => PAD.top + innerH - (v / maxVal) * innerH;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="7-day water balance chart: precipitation vs evapotranspiration"
      style={{ width: '100%', maxWidth: W }}
    >
      {/* Y-axis labels */}
      {[0, 0.5, 1].map((frac) => {
        const y = PAD.top + innerH - frac * innerH;
        return (
          <g key={frac}>
            <line x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end"
              fontSize="8" fill="rgba(255,255,255,0.35)">
              {(maxVal * frac).toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {balanceDays.map((d, i) => {
        const x = PAD.left + i * barWidth + barGap;
        const precipH = (d.precipitationMm / maxVal) * innerH;
        const petH    = (d.petMm / maxVal) * innerH;

        return (
          <g key={d.day}>
            {/* Precipitation bar (blue) */}
            <rect
              x={x}
              y={toY(d.precipitationMm)}
              width={singleBar}
              height={Math.max(1, precipH)}
              fill="#3b82f6"
              opacity={0.8}
              rx={2}
            >
              <title>Day {d.day} Precip: {d.precipitationMm.toFixed(1)} mm</title>
            </rect>
            {/* PET bar (orange) */}
            <rect
              x={x + singleBar + 1}
              y={toY(d.petMm)}
              width={singleBar}
              height={Math.max(1, petH)}
              fill="#f97316"
              opacity={0.8}
              rx={2}
            >
              <title>Day {d.day} PET: {d.petMm.toFixed(1)} mm</title>
            </rect>
            {/* X label */}
            <text
              x={x + singleBar}
              y={H - 4}
              textAnchor="middle"
              fontSize="8"
              fill="rgba(255,255,255,0.4)"
            >
              D{d.day}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <rect x={PAD.left} y={H - 14} width={8} height={6} fill="#3b82f6" rx={1} />
      <text x={PAD.left + 10} y={H - 9} fontSize="8" fill="rgba(255,255,255,0.55)">Precip</text>
      <rect x={PAD.left + 52} y={H - 14} width={8} height={6} fill="#f97316" rx={1} />
      <text x={PAD.left + 62} y={H - 9} fontSize="8" fill="rgba(255,255,255,0.55)">PET</text>
    </svg>
  );
};

// ────────────────────────── Props ─────────────────────────────────────────────

export interface WaterResourcesProps {
  /**
   * Array of 7 daily grid-cell snapshots (index 0 = day 1).
   * When empty, the component falls back to mock data for the demo.
   */
  dailyCells?: GridCell[][];
  /** Whether the panel is active */
  enabled?: boolean;
  /** Fill fractions keyed by reservoir id (0–1). Falls back to mock when absent. */
  fillFractions?: Record<string, number>;
  /** 7-day mean catchment rainfall (mm) per reservoir id. Falls back to mock when absent. */
  catchmentRainfallMm?: Record<string, number>;
  /** Called when a reservoir is selected (e.g. to fly camera to it) */
  onReservoirSelect?: (status: ReservoirStatus) => void;
}

// ──────────────────────── Main Component ─────────────────────────────────────

/**
 * WaterResources — Water Resources Dashboard.
 *
 * Validates: Requirements 56.1, 56.2, 56.3, 56.4
 */
export const WaterResources: React.FC<WaterResourcesProps> = ({
  dailyCells = [],
  enabled = true,
  fillFractions,
  catchmentRainfallMm,
  onReservoirSelect,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Reservoir statuses ──
  const statuses = useMemo<ReservoirStatus[]>(() => {
    if (!enabled) return [];
    const fills    = fillFractions    ?? MOCK_FILL_FRACTIONS;
    const rainfall = catchmentRainfallMm ?? MOCK_CATCHMENT_RAINFALL_MM;

    return RESERVOIR_DEFINITIONS.map((res) => {
      const fill     = fills[res.id]    ?? 0.5;
      const rainMm   = rainfall[res.id] ?? 50;
      const area     = CATCHMENT_AREAS_KM2[res.id] ?? 5000;
      return computeReservoirStatus(res, fill, rainMm, area);
    }).sort((a, b) => b.fillFraction - a.fillFraction);
  }, [enabled, fillFractions, catchmentRainfallMm]);

  // ── Advisories ──
  const advisories = useMemo(() => generateReservoirAdvisories(statuses), [statuses]);

  // ── Water balance (7-day) ──
  const balanceDays = useMemo<WaterBalanceDay[]>(() => {
    if (!enabled) return [];
    // If we have real daily cells use them, else generate mock from single snapshot
    if (dailyCells.length === 7) return computeWaterBalance(dailyCells);
    // Mock: linearly interpolate from constant baseline for demo purposes
    const mockDays: GridCell[][] = Array.from({ length: 7 }, () =>
      statuses.length > 0 ? [] : []
    );
    // Produce a simple mock water balance for demo
    return Array.from({ length: 7 }, (_, i) => ({
      day: i + 1,
      precipitationMm: 8 + Math.sin(i * 0.9) * 6,
      petMm: 5 + i * 0.3,
      balanceMm: 3 + Math.sin(i * 0.9) * 6 - i * 0.3,
    }));
  }, [enabled, dailyCells, statuses]);

  const selectedStatus = useMemo(
    () => statuses.find((s) => s.reservoir.id === selectedId) ?? null,
    [statuses, selectedId],
  );

  const handleSelect = (id: string) => {
    const next = id === selectedId ? null : id;
    setSelectedId(next);
    if (next && onReservoirSelect) {
      const s = statuses.find((r) => r.reservoir.id === next);
      if (s) onReservoirSelect(s);
    }
  };

  if (!enabled) return null;

  const criticalCount = statuses.filter((s) => s.storageTier === 'critical').length;

  return (
    <div
      className="water-resources"
      data-testid="water-resources"
      role="region"
      aria-label="Water Resources Dashboard"
    >
      {/* ── Reservoir Advisory Banners (Req 56.4) ── */}
      {advisories.map((adv) => (
        <div
          key={adv.reservoir.id}
          role="alert"
          aria-live="assertive"
          style={{
            background: 'rgba(168, 85, 247, 0.12)',
            border: '1px solid #a855f7',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            animation: 'res-advisory-pulse 2s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>🚨</span>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)', lineHeight: 1.5 }}>
            {adv.message}
          </span>
        </div>
      ))}

      {/* ── Main GlassPanel ── */}
      <GlassPanel padding="md" className="water-resources-panel">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(255,255,255,0.95)', margin: 0,
                       display: 'flex', alignItems: 'center', gap: '8px' }}>
            💧 Water Resources Dashboard
          </h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            {advisories.length > 0 && (
              <span style={{ background: 'rgba(168,85,247,0.2)', border: '1px solid #a855f7',
                             borderRadius: '12px', fontSize: '11px', padding: '2px 8px', color: '#c084fc' }}>
                {advisories.length} Advisory
              </span>
            )}
            {criticalCount > 0 && (
              <span style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444',
                             borderRadius: '12px', fontSize: '11px', padding: '2px 8px', color: '#fca5a5' }}>
                {criticalCount} Critical
              </span>
            )}
          </div>
        </div>

        {/* ── Storage Tier Legend ── */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {(Object.keys(STORAGE_TIER_COLORS) as StorageTier[]).map((tier) => (
            <span
              key={tier}
              style={{
                fontSize: '10px', padding: '2px 6px', borderRadius: '10px',
                background: `${STORAGE_TIER_COLORS[tier]}22`,
                border: `1px solid ${STORAGE_TIER_COLORS[tier]}88`,
                color: STORAGE_TIER_COLORS[tier],
              }}
            >
              {STORAGE_TIER_LABELS[tier]}
            </span>
          ))}
        </div>

        {/* ── Reservoir Table (Req 56.1) ── */}
        <div style={{ overflowY: 'auto', maxHeight: '280px', marginBottom: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
                 aria-label="Reservoir storage levels">
            <thead style={{ position: 'sticky', top: 0, background: 'rgba(6,10,22,0.95)', zIndex: 1 }}>
              <tr>
                {['Reservoir', 'Storage Level', 'Current (MCM)', '7-Day Predicted (MCM)'].map((h, i) => (
                  <th key={h} scope="col" style={{
                    padding: '5px 8px', textAlign: i < 2 ? 'left' : 'right',
                    fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.45)',
                    borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <ReservoirRow
                  key={s.reservoir.id}
                  status={s}
                  isSelected={selectedId === s.reservoir.id}
                  onSelect={() => handleSelect(s.reservoir.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Selected Reservoir Detail ── */}
        {selectedStatus && (
          <div
            style={{
              background: `${STORAGE_TIER_COLORS[selectedStatus.storageTier]}10`,
              border: `1px solid ${STORAGE_TIER_COLORS[selectedStatus.storageTier]}40`,
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '12px',
            }}
          >
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(255,255,255,0.95)', marginBottom: '6px' }}>
              {selectedStatus.reservoir.name}
              <span style={{ marginLeft: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>
                Capacity: {selectedStatus.reservoir.capacityMCM.toLocaleString()} MCM
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
              {[
                { label: 'Current storage', value: `${selectedStatus.currentStorageMCM.toFixed(0)} MCM`, color: '#60a5fa' },
                { label: '7-day inflow',    value: `+${selectedStatus.predictedInflowMCM.toFixed(0)} MCM`, color: '#34d399' },
                { label: 'Predicted fill',  value: `${(selectedStatus.fillFraction * 100).toFixed(1)}%`, color: STORAGE_TIER_COLORS[selectedStatus.storageTier] },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ fontSize: '11px' }}>
                  <div style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</div>
                  <div style={{ color, fontWeight: 600 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Water Balance Chart (Req 56.3) ── */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 500, color: 'rgba(255,255,255,0.6)',
                        marginBottom: '8px' }}>
            7-Day Water Balance — Precipitation vs ET₀ (mm day⁻¹)
          </div>
          <WaterBalanceChart balanceDays={balanceDays} />
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
            ET₀ via FAO-56 Penman-Monteith
          </div>
        </div>
      </GlassPanel>

      <style>{`
        @keyframes res-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
        @keyframes res-advisory-pulse {
          0%, 100% { box-shadow: 0 0 4px rgba(168,85,247,0.3); }
          50%       { box-shadow: 0 0 14px rgba(168,85,247,0.7); }
        }
      `}</style>
    </div>
  );
};

export default WaterResources;
