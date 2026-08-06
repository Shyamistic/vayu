/**
 * AgricultureAdvisory — Crop-specific weather advisories for the 7-day forecast.
 *
 * Exports pure functions for GDD computation and advisory logic (testable),
 * plus a React component that:
 *  1. Provides crop-specific advisories (rice, wheat, cotton, sugarcane, tea, coffee) (Req 19.1)
 *  2. Generates "Delay Sowing" or "Harvest Immediately" advisories when
 *     rainfall > 50 mm/day for active crop stages (Req 19.2)
 *  3. Displays a Crop Calendar overlay with optimal planting/harvesting windows (Req 19.3)
 *  4. Computes Growing Degree Days (GDD) from temperature predictions and displays
 *     accumulated GDD progress for selected crops (Req 19.4)
 *
 * Validates: Requirements 19.1, 19.2, 19.3, 19.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Crop Types & Constants ───────────────────────────────────────────────────

/** All crop types supported by the advisory system (Req 19.1) */
export type CropId = 'rice' | 'wheat' | 'cotton' | 'sugarcane' | 'tea' | 'coffee';

/** A month index (1 = January … 12 = December) */
export type MonthIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Active crop stage that determines which advisory to issue */
export type CropStage = 'pre-sowing' | 'sowing' | 'vegetative' | 'flowering' | 'harvest';

/** Advisory type triggered by extreme rainfall (Req 19.2) */
export type RainfallAdvisoryType = 'Delay Sowing' | 'Harvest Immediately' | 'None';

/** Crop calendar entry: optimal planting and harvesting months (Req 19.3) */
export interface CropCalendarEntry {
  crop: CropId;
  label: string;
  /** Optimal sowing months (1-indexed) */
  sowingMonths: MonthIndex[];
  /** Optimal harvest months (1-indexed) */
  harvestMonths: MonthIndex[];
  /** Base temperature for GDD computation in °C */
  baseTemp: number;
  /** Upper (cutoff) temperature for GDD computation in °C */
  upperTemp: number;
  /** GDD required from sowing to harvest */
  gddToMaturity: number;
  /** Typical active stage during Kharif (Jun–Nov) or Rabi (Nov–Apr) */
  activeStage: CropStage;
  /** Icon emoji for display */
  icon: string;
}

/** Advisory generated for a grid cell and crop */
export interface CropAdvisory {
  cell: GridCell;
  crop: CropId;
  /** Day index (1–7) that triggered the advisory */
  triggerDay: number;
  /** Rainfall on the trigger day in mm */
  triggerRainfall: number;
  advisoryType: RainfallAdvisoryType;
  message: string;
}

/** Per-crop GDD accumulation result (Req 19.4) */
export interface GDDResult {
  crop: CropId;
  /** Total accumulated GDD */
  accumulatedGDD: number;
  /** GDD required to reach maturity */
  gddToMaturity: number;
  /** Progress from 0 to 1 */
  progress: number;
  /** Estimated days remaining at current GDD accumulation rate */
  estimatedDaysRemaining: number | null;
}

// ── Crop Calendar Data (Req 19.3) ────────────────────────────────────────────

/**
 * Crop calendar with optimal planting/harvesting windows for Indian agriculture.
 * GDD base and upper temperatures sourced from ICAR agronomic guidelines.
 */
export const CROP_CALENDAR: Record<CropId, CropCalendarEntry> = {
  rice: {
    crop: 'rice',
    label: 'Rice (Paddy)',
    sowingMonths: [6, 7] as MonthIndex[],
    harvestMonths: [10, 11] as MonthIndex[],
    baseTemp: 10,
    upperTemp: 36,
    gddToMaturity: 1200,
    activeStage: 'sowing',
    icon: '🌾',
  },
  wheat: {
    crop: 'wheat',
    label: 'Wheat',
    sowingMonths: [11, 12] as MonthIndex[],
    harvestMonths: [3, 4] as MonthIndex[],
    baseTemp: 0,
    upperTemp: 30,
    gddToMaturity: 1600,
    activeStage: 'pre-sowing',
    icon: '🌿',
  },
  cotton: {
    crop: 'cotton',
    label: 'Cotton',
    sowingMonths: [5, 6] as MonthIndex[],
    harvestMonths: [10, 11, 12] as MonthIndex[],
    baseTemp: 15,
    upperTemp: 40,
    gddToMaturity: 2200,
    activeStage: 'vegetative',
    icon: '🌸',
  },
  sugarcane: {
    crop: 'sugarcane',
    label: 'Sugarcane',
    sowingMonths: [2, 3, 10, 11] as MonthIndex[],
    harvestMonths: [12, 1, 2, 3] as MonthIndex[],
    baseTemp: 10,
    upperTemp: 38,
    gddToMaturity: 3000,
    activeStage: 'vegetative',
    icon: '🎋',
  },
  tea: {
    crop: 'tea',
    label: 'Tea',
    sowingMonths: [3, 4] as MonthIndex[],
    harvestMonths: [3, 4, 5, 6, 7, 8, 9, 10] as MonthIndex[],
    baseTemp: 10,
    upperTemp: 35,
    gddToMaturity: 900,
    activeStage: 'harvest',
    icon: '🍃',
  },
  coffee: {
    crop: 'coffee',
    label: 'Coffee',
    sowingMonths: [6, 7] as MonthIndex[],
    harvestMonths: [11, 12, 1] as MonthIndex[],
    baseTemp: 15,
    upperTemp: 32,
    gddToMaturity: 1400,
    activeStage: 'flowering',
    icon: '☕',
  },
};

/** Rainfall threshold in mm/day above which an advisory is triggered (Req 19.2) */
export const RAINFALL_ADVISORY_THRESHOLD_MM = 50;

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Compute Growing Degree Days for a single day.
 *
 * GDD = clamp((tMax + tMin) / 2 - baseTemp, 0, upperTemp - baseTemp)
 *
 * - Values below baseTemp contribute 0 GDD.
 * - Values above upperTemp are clamped to upperTemp (heat cutoff).
 *
 * @param tempMax - Daily maximum temperature in °C
 * @param tempMin - Daily minimum temperature in °C
 * @param baseTemp - Base (minimum) temperature for crop in °C
 * @param upperTemp - Upper (cutoff) temperature for crop in °C
 * @returns GDD for the day (always ≥ 0)
 */
export function computeDailyGDD(
  tempMax: number,
  tempMin: number,
  baseTemp: number,
  upperTemp: number,
): number {
  const clampedMax = Math.min(tempMax, upperTemp);
  const clampedMin = Math.max(tempMin, baseTemp);
  // If daily min > upper threshold, both get clamped to upperTemp → 0 GDD
  if (clampedMin > clampedMax) return 0;
  const meanTemp = (clampedMax + clampedMin) / 2;
  return Math.max(0, meanTemp - baseTemp);
}

/**
 * Accumulate GDD over a 7-day forecast for a given crop and grid cell series.
 *
 * Returns a GDDResult with progress and estimated days remaining.
 * Validates: Requirement 19.4
 */
export function computeGDDAccumulation(
  forecastCells: GridCell[],
  cropId: CropId,
): GDDResult {
  const calendar = CROP_CALENDAR[cropId];
  let accumulatedGDD = 0;

  for (const cell of forecastCells) {
    accumulatedGDD += computeDailyGDD(
      cell.temp_max,
      cell.temp_min,
      calendar.baseTemp,
      calendar.upperTemp,
    );
  }

  const progress = Math.min(1, accumulatedGDD / calendar.gddToMaturity);
  const remainingGDD = Math.max(0, calendar.gddToMaturity - accumulatedGDD);

  // Estimate days remaining at average daily GDD rate
  const avgDailyGDD = forecastCells.length > 0 ? accumulatedGDD / forecastCells.length : 0;
  const estimatedDaysRemaining =
    avgDailyGDD > 0 ? Math.ceil(remainingGDD / avgDailyGDD) : null;

  return {
    crop: cropId,
    accumulatedGDD: Math.round(accumulatedGDD * 10) / 10,
    gddToMaturity: calendar.gddToMaturity,
    progress,
    estimatedDaysRemaining,
  };
}

/**
 * Determine the rainfall-based advisory type for an active crop stage.
 *
 * When rainfall > 50 mm/day (Req 19.2):
 * - 'harvest' or 'flowering' stage → "Harvest Immediately"
 * - 'pre-sowing' or 'sowing' stage → "Delay Sowing"
 * - 'vegetative' stage → no action-critical advisory
 *
 * Validates: Requirement 19.2
 */
export function getRainfallAdvisory(
  rainfallMmPerDay: number,
  stage: CropStage,
): RainfallAdvisoryType {
  if (rainfallMmPerDay <= RAINFALL_ADVISORY_THRESHOLD_MM) return 'None';

  switch (stage) {
    case 'harvest':
    case 'flowering':
      return 'Harvest Immediately';
    case 'pre-sowing':
    case 'sowing':
      return 'Delay Sowing';
    case 'vegetative':
    default:
      return 'None';
  }
}

/**
 * Generate all crop advisories for a grid cell over the 7-day forecast.
 *
 * Returns one advisory per (cell × crop × trigger-day) combination.
 * Only issues advisories when rainfall exceeds the 50 mm threshold.
 *
 * Validates: Requirements 19.1, 19.2
 */
export function generateAdvisories(
  forecastCells: GridCell[],
  crops: CropId[] = Object.keys(CROP_CALENDAR) as CropId[],
): CropAdvisory[] {
  const advisories: CropAdvisory[] = [];

  forecastCells.forEach((cell, dayIndex) => {
    const triggerDay = dayIndex + 1;
    for (const cropId of crops) {
      const calendar = CROP_CALENDAR[cropId];
      const advisoryType = getRainfallAdvisory(cell.rainfall, calendar.activeStage);

      if (advisoryType !== 'None') {
        const message = buildAdvisoryMessage(cropId, advisoryType, cell.rainfall, triggerDay);
        advisories.push({
          cell,
          crop: cropId,
          triggerDay,
          triggerRainfall: cell.rainfall,
          advisoryType,
          message,
        });
      }
    }
  });

  return advisories;
}

/**
 * Build a human-readable advisory message for display.
 */
export function buildAdvisoryMessage(
  cropId: CropId,
  advisoryType: RainfallAdvisoryType,
  rainfall: number,
  day: number,
): string {
  const calendar = CROP_CALENDAR[cropId];
  if (advisoryType === 'Delay Sowing') {
    return `${calendar.label}: Delay sowing — heavy rainfall of ${rainfall.toFixed(1)} mm predicted on Day ${day}. Wait for field conditions to improve.`;
  }
  if (advisoryType === 'Harvest Immediately') {
    return `${calendar.label}: Harvest immediately — ${rainfall.toFixed(1)} mm rainfall on Day ${day} may damage standing crop.`;
  }
  return '';
}

/**
 * Determine which crops are in an active planting or harvesting window
 * for the given calendar month.
 *
 * Validates: Requirement 19.3
 */
export function getActiveWindowCrops(
  month: MonthIndex,
): { crop: CropId; windowType: 'sowing' | 'harvest' }[] {
  const active: { crop: CropId; windowType: 'sowing' | 'harvest' }[] = [];
  for (const [cropId, entry] of Object.entries(CROP_CALENDAR) as [CropId, CropCalendarEntry][]) {
    if ((entry.sowingMonths as number[]).includes(month)) {
      active.push({ crop: cropId, windowType: 'sowing' });
    }
    if ((entry.harvestMonths as number[]).includes(month)) {
      active.push({ crop: cropId, windowType: 'harvest' });
    }
  }
  return active;
}

// ── React Component ──────────────────────────────────────────────────────────

export interface AgricultureAdvisoryProps {
  /** 7-day forecast grid cells for the selected point/region (one entry per forecast day) */
  forecastCells: GridCell[];
  /** Whether the panel is active */
  enabled?: boolean;
  /** Current calendar month (1–12) for crop calendar overlay */
  currentMonth?: MonthIndex;
}

const ADVISORY_COLORS: Record<RainfallAdvisoryType, string> = {
  'Delay Sowing': '#f59e0b',       // amber
  'Harvest Immediately': '#ef4444', // red
  None: 'transparent',
};

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * AgricultureAdvisory panel component.
 *
 * Renders:
 * 1. Active advisory banners (Delay Sowing / Harvest Immediately)
 * 2. Crop Calendar overlay showing current-month planting/harvest windows
 * 3. GDD progress bars for all supported crops
 */
export const AgricultureAdvisory: React.FC<AgricultureAdvisoryProps> = ({
  forecastCells,
  enabled = true,
  currentMonth,
}) => {
  const month = currentMonth ?? ((new Date().getMonth() + 1) as MonthIndex);

  const [selectedCrop, setSelectedCrop] = useState<CropId>('rice');

  const advisories = useMemo(() => {
    if (!enabled || forecastCells.length === 0) return [];
    return generateAdvisories(forecastCells);
  }, [forecastCells, enabled]);

  const gddResults = useMemo(() => {
    if (forecastCells.length === 0) return [];
    return (Object.keys(CROP_CALENDAR) as CropId[]).map((crop) =>
      computeGDDAccumulation(forecastCells, crop),
    );
  }, [forecastCells]);

  const activeWindowCrops = useMemo(() => getActiveWindowCrops(month), [month]);

  const selectedGDD = useMemo(
    () => gddResults.find((r) => r.crop === selectedCrop),
    [gddResults, selectedCrop],
  );

  if (!enabled) return null;

  return (
    <div className="agriculture-advisory" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* ── Advisory Banners ── */}
      {advisories.length > 0 && (
        <div
          role="alert"
          aria-live="polite"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          {advisories.slice(0, 5).map((adv, idx) => (
            <div
              key={`${adv.crop}-${adv.triggerDay}-${idx}`}
              style={{
                background: `${ADVISORY_COLORS[adv.advisoryType]}18`,
                border: `1px solid ${ADVISORY_COLORS[adv.advisoryType]}`,
                borderRadius: '8px',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                animation: 'agri-advisory-pulse 2.5s ease-in-out infinite',
              }}
            >
              <span style={{ fontSize: '16px', flexShrink: 0 }}>
                {CROP_CALENDAR[adv.crop].icon}
              </span>
              <div style={{ flex: 1 }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: ADVISORY_COLORS[adv.advisoryType],
                    display: 'block',
                    marginBottom: '2px',
                  }}
                >
                  {adv.advisoryType} — Day {adv.triggerDay}
                </span>
                <span style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a75))' }}>
                  {adv.message}
                </span>
              </div>
            </div>
          ))}
          {advisories.length > 5 && (
            <p style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', textAlign: 'center', margin: 0 }}>
              +{advisories.length - 5} more advisories
            </p>
          )}
        </div>
      )}

      {advisories.length === 0 && forecastCells.length > 0 && (
        <div
          style={{
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.4)',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '12px',
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
          }}
        >
          ✅ No rainfall advisories for the 7-day forecast period. Conditions are favourable.
        </div>
      )}

      {/* ── Crop Calendar Overlay (Req 19.3) ── */}
      <GlassPanel padding="md">
        <h3
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            margin: '0 0 10px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          🗓 Crop Calendar — {MONTH_NAMES[month]}
        </h3>

        {/* Month strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gap: '2px',
            marginBottom: '10px',
          }}
          aria-label="Monthly crop calendar"
        >
          {Array.from({ length: 12 }, (_, i) => {
            const m = (i + 1) as MonthIndex;
            const isCurrent = m === month;
            return (
              <div
                key={m}
                title={MONTH_NAMES[m]}
                style={{
                  textAlign: 'center',
                  fontSize: '9px',
                  fontWeight: isCurrent ? 700 : 400,
                  color: isCurrent ? '#60a5fa' : 'rgba(var(--fg-rgb),var(--fg-a4))',
                  padding: '2px 0',
                  borderBottom: isCurrent ? '2px solid #60a5fa' : '2px solid transparent',
                }}
              >
                {MONTH_NAMES[m]}
              </div>
            );
          })}
        </div>

        {/* Crop rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {(Object.values(CROP_CALENDAR) as CropCalendarEntry[]).map((entry) => (
            <div key={entry.crop} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', width: '18px', textAlign: 'center' }}>{entry.icon}</span>
              <span
                style={{
                  fontSize: '11px',
                  color: 'rgba(var(--fg-rgb),var(--fg-a7))',
                  width: '72px',
                  flexShrink: 0,
                }}
              >
                {entry.label}
              </span>
              <div
                style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(12, 1fr)',
                  gap: '2px',
                  height: '12px',
                }}
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const m = (i + 1) as MonthIndex;
                  const isSow = (entry.sowingMonths as number[]).includes(m);
                  const isHarv = (entry.harvestMonths as number[]).includes(m);
                  const bg = isSow
                    ? '#22c55e'   // green for sowing
                    : isHarv
                    ? '#f59e0b'   // amber for harvest
                    : 'rgba(var(--fg-rgb),var(--fg-a05))';
                  return (
                    <div
                      key={m}
                      title={isSow ? 'Sowing' : isHarv ? 'Harvest' : undefined}
                      style={{
                        height: '12px',
                        borderRadius: '2px',
                        background: bg,
                        opacity: m === month ? 1 : 0.7,
                        outline: m === month ? `1px solid rgba(var(--fg-rgb),var(--fg-a3))` : 'none',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          {[{ color: '#22c55e', label: 'Sowing' }, { color: '#f59e0b', label: 'Harvest' }].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} />
              <span style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Active windows this month */}
        {activeWindowCrops.length > 0 && (
          <div style={{ marginTop: '8px', padding: '6px 8px', background: 'rgba(96,165,250,0.1)', borderRadius: '6px' }}>
            <p style={{ margin: 0, fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a7))' }}>
              <strong style={{ color: '#60a5fa' }}>Active this month: </strong>
              {activeWindowCrops
                .map((w) => `${CROP_CALENDAR[w.crop].icon} ${CROP_CALENDAR[w.crop].label} (${w.windowType})`)
                .join(' · ')}
            </p>
          </div>
        )}
      </GlassPanel>

      {/* ── GDD Progress Panel (Req 19.4) ── */}
      <GlassPanel padding="md">
        <h3
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            margin: '0 0 10px 0',
          }}
        >
          🌡 Growing Degree Days (7-Day Forecast)
        </h3>

        {/* Crop selector tabs */}
        <div
          style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}
          role="tablist"
          aria-label="Select crop for GDD"
        >
          {(Object.keys(CROP_CALENDAR) as CropId[]).map((cropId) => (
            <button
              key={cropId}
              role="tab"
              aria-selected={selectedCrop === cropId}
              onClick={() => setSelectedCrop(cropId)}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: `1px solid ${selectedCrop === cropId ? '#60a5fa' : 'rgba(var(--fg-rgb),var(--fg-a15))'}`,
                background: selectedCrop === cropId ? 'rgba(96,165,250,0.15)' : 'transparent',
                color: selectedCrop === cropId ? '#93c5fd' : 'rgba(var(--fg-rgb),var(--fg-a6))',
                fontSize: '11px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {CROP_CALENDAR[cropId].icon} {CROP_CALENDAR[cropId].label}
            </button>
          ))}
        </div>

        {/* GDD detail for selected crop */}
        {selectedGDD && (
          <GDDProgressCard gdd={selectedGDD} />
        )}

        {/* All crops summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
          {gddResults.map((gdd) => (
            <div key={gdd.crop} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', width: '18px', textAlign: 'center' }}>
                {CROP_CALENDAR[gdd.crop].icon}
              </span>
              <span style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a6))', width: '72px', flexShrink: 0 }}>
                {CROP_CALENDAR[gdd.crop].label}
              </span>
              <div
                style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'rgba(var(--fg-rgb),var(--fg-a1))', overflow: 'hidden' }}
                role="progressbar"
                aria-valuenow={Math.round(gdd.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${CROP_CALENDAR[gdd.crop].label} GDD progress`}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${gdd.progress * 100}%`,
                    background: gdd.progress >= 1 ? '#22c55e' : '#60a5fa',
                    borderRadius: '3px',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <span style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', width: '34px', textAlign: 'right', flexShrink: 0 }}>
                {Math.round(gdd.progress * 100)}%
              </span>
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* CSS animations */}
      <style>{`
        @keyframes agri-advisory-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
      `}</style>
    </div>
  );
};

// ── GDD Progress Card Sub-Component ─────────────────────────────────────────

interface GDDProgressCardProps {
  gdd: GDDResult;
}

const GDDProgressCard: React.FC<GDDProgressCardProps> = ({ gdd }) => {
  const calendar = CROP_CALENDAR[gdd.crop];
  const pct = Math.round(gdd.progress * 100);
  const barColor = gdd.progress >= 1 ? '#22c55e' : gdd.progress >= 0.7 ? '#f59e0b' : '#60a5fa';

  return (
    <div
      style={{
        background: 'rgba(var(--fg-rgb),var(--fg-a05))',
        border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
        borderRadius: '8px',
        padding: '10px 12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(var(--fg-rgb),var(--fg-a75))' }}>
          {calendar.icon} {calendar.label}
        </span>
        <span style={{ fontSize: '12px', color: barColor, fontWeight: 600 }}>
          {gdd.accumulatedGDD} / {gdd.gddToMaturity} GDD
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: '10px',
          borderRadius: '5px',
          background: 'rgba(var(--fg-rgb),var(--fg-a1))',
          overflow: 'hidden',
          marginBottom: '8px',
        }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${calendar.label} GDD accumulated: ${pct}%`}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${barColor}99, ${barColor})`,
            borderRadius: '5px',
            transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a6))' }}>
        <span>{pct}% to maturity</span>
        {gdd.estimatedDaysRemaining !== null ? (
          <span>~{gdd.estimatedDaysRemaining} days remaining</span>
        ) : (
          <span>Insufficient forecast data</span>
        )}
      </div>

      <div style={{ marginTop: '6px', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
        Base: {calendar.baseTemp}°C · Upper: {calendar.upperTemp}°C
      </div>

      {gdd.progress >= 1 && (
        <div
          style={{
            marginTop: '6px',
            padding: '4px 8px',
            background: 'rgba(34,197,94,0.15)',
            border: '1px solid rgba(34,197,94,0.4)',
            borderRadius: '4px',
            fontSize: '11px',
            color: '#86efac',
          }}
        >
          ✅ Maturity GDD reached — crop may be ready for harvest.
        </div>
      )}
    </div>
  );
};

export default AgricultureAdvisory;
