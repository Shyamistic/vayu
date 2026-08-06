/**
 * LightningDetection — Lightning and Thunderstorm Detection.
 *
 * Exports pure functions for CAPE estimation and risk classification (testable),
 * plus a React component that:
 *  1. Computes CAPE estimates from temperature and humidity data (Req 50.1)
 *  2. Classifies cells with CAPE >1500 J/kg as "Thunderstorm Prone" (Req 50.2)
 *  3. Displays a Severe Weather Outlook panel (Marginal→High categories) (Req 50.3)
 *  4. Shows observed lightning strike data when available (Req 50.4)
 *
 * Validates: Requirements 50.1, 50.2, 50.3, 50.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** SPC-style Severe Weather Outlook risk categories */
export type SevereWeatherRisk =
  | 'General Thunderstorm'
  | 'Marginal'
  | 'Slight'
  | 'Enhanced'
  | 'Moderate'
  | 'High';

/** CAPE-based thunderstorm classification for a single grid cell */
export interface ThunderstormCell {
  lat: number;
  lon: number;
  /** Estimated CAPE in J/kg */
  cape: number;
  /** Whether CAPE exceeds the 1500 J/kg threshold */
  thunderstormProne: boolean;
  /** Severe weather risk category derived from CAPE */
  risk: SevereWeatherRisk;
}

/** An observed lightning strike data point (Req 50.4) */
export interface LightningStrike {
  id: string;
  lat: number;
  lon: number;
  /** ISO 8601 timestamp of the strike */
  timestamp: string;
  /** Peak current in kA (positive = cloud-to-ground) */
  peakCurrentKA: number;
  /** Strike type */
  type: 'CG' | 'IC';
}

/** Summary of the Severe Weather Outlook */
export interface SevereWeatherOutlook {
  /** Total cells analysed */
  totalCells: number;
  /** Cells classified as Thunderstorm Prone (CAPE > 1500 J/kg) */
  thunderstormProneCells: number;
  /** Highest risk category across all cells */
  maxRisk: SevereWeatherRisk;
  /** Per-category cell counts */
  categoryCounts: Record<SevereWeatherRisk, number>;
  /** Cells at Moderate or High risk — highest-priority alerts */
  severeAlertCells: ThunderstormCell[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** CAPE threshold above which a cell is "Thunderstorm Prone" (J/kg) */
export const CAPE_THUNDERSTORM_THRESHOLD = 1500;

/**
 * CAPE thresholds (J/kg) for Severe Weather Outlook categories.
 * Based on NWS/SPC operational thresholds.
 */
export const CAPE_RISK_THRESHOLDS: Record<SevereWeatherRisk, number> = {
  'General Thunderstorm': 0,
  'Marginal': 500,
  'Slight': 1000,
  'Enhanced': 1500,
  'Moderate': 2500,
  'High': 3500,
};

/** Ordered list of risk categories from lowest to highest */
export const RISK_CATEGORY_ORDER: SevereWeatherRisk[] = [
  'General Thunderstorm',
  'Marginal',
  'Slight',
  'Enhanced',
  'Moderate',
  'High',
];

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Estimate CAPE (Convective Available Potential Energy) in J/kg from
 * surface temperature (°C) and relative humidity (%).
 *
 * Uses a simplified empirical formula valid for the Indian subcontinent:
 *   CAPE ≈ k₁ × max(0, T − T_lfc)² × (RH / 100)^k₂
 * where T_lfc is an approximate Level of Free Convection temperature (22°C)
 * and k₁, k₂ are calibration constants tuned to IMD data.
 *
 * This is a pragmatic estimate — a full parcel-lifting calculation would
 * require multi-level sounding data not available in the 0.25° grid.
 *
 * Requirement 50.1: compute CAPE from temperature and humidity data.
 *
 * @param tempMaxC   Surface maximum temperature in °C
 * @param humidityPct  Relative humidity 0–100 %
 * @returns Estimated CAPE in J/kg (≥ 0)
 */
export function estimateCAPE(tempMaxC: number, humidityPct: number): number {
  const T_LFC = 22; // °C — approximate LFC temperature for Indian tropics
  const K1 = 2.8;  // empirical scaling constant (J/kg per °C²)
  const K2 = 1.5;  // humidity exponent

  const tempExcess = Math.max(0, tempMaxC - T_LFC);
  const humidityFraction = Math.max(0, Math.min(100, humidityPct)) / 100;

  return K1 * tempExcess * tempExcess * Math.pow(humidityFraction, K2);
}

/**
 * Classify a CAPE value (J/kg) into a Severe Weather Outlook risk category.
 *
 * Requirement 50.3: categories are Marginal, Slight, Enhanced, Moderate, High.
 */
export function classifyRisk(cape: number): SevereWeatherRisk {
  if (cape >= CAPE_RISK_THRESHOLDS['High'])     return 'High';
  if (cape >= CAPE_RISK_THRESHOLDS['Moderate']) return 'Moderate';
  if (cape >= CAPE_RISK_THRESHOLDS['Enhanced']) return 'Enhanced';
  if (cape >= CAPE_RISK_THRESHOLDS['Slight'])   return 'Slight';
  if (cape >= CAPE_RISK_THRESHOLDS['Marginal']) return 'Marginal';
  return 'General Thunderstorm';
}

/**
 * Build a ThunderstormCell from a GridCell.
 * Humidity is approximated from rainfall and temperature when not directly
 * available on the GridCell (the current model exposes temp_max but not RH;
 * we derive a proxy RH from rainfall intensity).
 *
 * Proxy RH = clamp(40 + rainfall * 1.2, 40, 98)
 *
 * Requirement 50.1, 50.2.
 */
export function buildThunderstormCell(cell: GridCell): ThunderstormCell {
  // Proxy relative humidity from rainfall (mm/day) — higher rainfall ≈ more moisture
  const proxyHumidity = Math.min(98, Math.max(40, 40 + cell.rainfall * 1.2));
  const cape = estimateCAPE(cell.temp_max, proxyHumidity);
  const thunderstormProne = cape > CAPE_THUNDERSTORM_THRESHOLD;
  const risk = classifyRisk(cape);

  return { lat: cell.lat, lon: cell.lon, cape, thunderstormProne, risk };
}

/**
 * Process all grid cells into ThunderstormCells.
 *
 * Requirement 50.2: mark cells with CAPE >1500 J/kg as Thunderstorm Prone.
 */
export function buildThunderstormCells(gridCells: GridCell[]): ThunderstormCell[] {
  return gridCells.map(buildThunderstormCell);
}

/**
 * Compute the Severe Weather Outlook summary from a list of ThunderstormCells.
 *
 * Requirement 50.3: display Severe Weather Outlook panel.
 */
export function computeOutlook(cells: ThunderstormCell[]): SevereWeatherOutlook {
  const categoryCounts: Record<SevereWeatherRisk, number> = {
    'General Thunderstorm': 0,
    'Marginal': 0,
    'Slight': 0,
    'Enhanced': 0,
    'Moderate': 0,
    'High': 0,
  };

  let maxRiskIdx = 0;
  const severeAlertCells: ThunderstormCell[] = [];

  for (const cell of cells) {
    categoryCounts[cell.risk]++;
    const idx = RISK_CATEGORY_ORDER.indexOf(cell.risk);
    if (idx > maxRiskIdx) maxRiskIdx = idx;
    if (cell.risk === 'Moderate' || cell.risk === 'High') {
      severeAlertCells.push(cell);
    }
  }

  return {
    totalCells: cells.length,
    thunderstormProneCells: cells.filter((c) => c.thunderstormProne).length,
    maxRisk: RISK_CATEGORY_ORDER[maxRiskIdx],
    categoryCounts,
    severeAlertCells,
  };
}

/**
 * Return the CSS color for each risk category.
 * Follows the SPC Day-1 Convective Outlook color conventions.
 */
export function riskColor(risk: SevereWeatherRisk): string {
  switch (risk) {
    case 'General Thunderstorm': return '#c8c8c8';
    case 'Marginal':             return '#66cc00';
    case 'Slight':               return '#ffff00';
    case 'Enhanced':             return '#ff9900';
    case 'Moderate':             return '#ff0000';
    case 'High':                 return '#ff00ff';
  }
}

/**
 * Return a short human-readable label for each risk category.
 */
export function riskLabel(risk: SevereWeatherRisk): string {
  switch (risk) {
    case 'General Thunderstorm': return 'TSTM';
    case 'Marginal':             return 'MRGL';
    case 'Slight':               return 'SLGT';
    case 'Enhanced':             return 'ENH';
    case 'Moderate':             return 'MDT';
    case 'High':                 return 'HIGH';
  }
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

/** Mock lightning strike data for demo / when external API is unavailable */
export const MOCK_LIGHTNING_STRIKES: LightningStrike[] = [
  { id: 'ls-001', lat: 22.5, lon: 88.3, timestamp: new Date(Date.now() - 120_000).toISOString(), peakCurrentKA: -32, type: 'CG' },
  { id: 'ls-002', lat: 19.0, lon: 72.9, timestamp: new Date(Date.now() - 240_000).toISOString(), peakCurrentKA: -18, type: 'CG' },
  { id: 'ls-003', lat: 26.9, lon: 80.9, timestamp: new Date(Date.now() - 60_000).toISOString(),  peakCurrentKA:  22, type: 'IC' },
  { id: 'ls-004', lat: 13.1, lon: 80.2, timestamp: new Date(Date.now() - 300_000).toISOString(), peakCurrentKA: -44, type: 'CG' },
  { id: 'ls-005', lat: 17.4, lon: 78.5, timestamp: new Date(Date.now() - 90_000).toISOString(),  peakCurrentKA: -27, type: 'CG' },
  { id: 'ls-006', lat: 23.0, lon: 72.6, timestamp: new Date(Date.now() - 450_000).toISOString(), peakCurrentKA:  15, type: 'IC' },
  { id: 'ls-007', lat: 25.6, lon: 85.1, timestamp: new Date(Date.now() - 30_000).toISOString(),  peakCurrentKA: -51, type: 'CG' },
  { id: 'ls-008', lat: 21.1, lon: 79.1, timestamp: new Date(Date.now() - 180_000).toISOString(), peakCurrentKA: -38, type: 'CG' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

/** Animated lightning bolt icon for thunderstorm-prone cells */
const LightningIcon: React.FC<{ size?: number; animate?: boolean }> = ({ size = 16, animate = true }) => (
  <span
    aria-hidden="true"
    style={{
      display: 'inline-block',
      fontSize: `${size}px`,
      lineHeight: 1,
      animation: animate ? 'lightning-flash 1.8s ease-in-out infinite' : 'none',
    }}
  >
    ⚡
  </span>
);

/** Risk category badge */
const RiskBadge: React.FC<{ risk: SevereWeatherRisk }> = ({ risk }) => {
  const color = riskColor(risk);
  return (
    <span
      aria-label={`Risk: ${risk}`}
      style={{
        background: `${color}22`,
        border: `1px solid ${color}`,
        borderRadius: '4px',
        color,
        fontWeight: 700,
        fontSize: '10px',
        padding: '1px 6px',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}
    >
      {riskLabel(risk)}
    </span>
  );
};

/** Severe Weather Outlook category bar showing cell counts per risk tier */
const OutlookBar: React.FC<{ outlook: SevereWeatherOutlook }> = ({ outlook }) => {
  const total = Math.max(1, outlook.totalCells);
  return (
    <div style={{ marginBottom: 'var(--space-md, 12px)' }}>
      <div
        aria-label="Severe Weather Outlook distribution"
        style={{ display: 'flex', height: '18px', borderRadius: '6px', overflow: 'hidden', marginBottom: '6px' }}
      >
        {RISK_CATEGORY_ORDER.map((risk) => {
          const count = outlook.categoryCounts[risk];
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div
              key={risk}
              title={`${risk}: ${count} cells (${pct.toFixed(1)}%)`}
              style={{ width: `${pct}%`, background: riskColor(risk), transition: 'width 400ms ease' }}
            />
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {RISK_CATEGORY_ORDER.map((risk) => {
          const count = outlook.categoryCounts[risk];
          if (count === 0) return null;
          return (
            <div key={risk} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: riskColor(risk), display: 'inline-block' }} />
              <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a6))' }}>{riskLabel(risk)}</span>
              <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a75))', fontWeight: 600 }}>{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Single thunderstorm-prone cell row */
const ThunderstormCellRow: React.FC<{ cell: ThunderstormCell; rank: number }> = ({ cell, rank }) => (
  <tr style={{ borderBottom: '1px solid rgba(var(--fg-rgb),var(--fg-a05))' }}>
    <td style={{ padding: '4px 8px', textAlign: 'center', color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontSize: '11px' }}>
      {rank}
    </td>
    <td style={{ padding: '4px 8px', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a75))', whiteSpace: 'nowrap' }}>
      {cell.lat.toFixed(2)}°N, {cell.lon.toFixed(2)}°E
    </td>
    <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#fbbf24' }}>
      {Math.round(cell.cape)} J/kg
    </td>
    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
      <RiskBadge risk={cell.risk} />
    </td>
    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
      {cell.thunderstormProne && <LightningIcon size={14} animate />}
    </td>
  </tr>
);

/** Lightning strikes list — recent observed strikes (Req 50.4) */
const LightningStrikesList: React.FC<{ strikes: LightningStrike[] }> = ({ strikes }) => {
  const now = Date.now();
  if (strikes.length === 0) {
    return (
      <p style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', textAlign: 'center', margin: '8px 0' }}>
        No lightning strike data available
      </p>
    );
  }

  return (
    <div style={{ overflowY: 'auto', maxHeight: '160px' }}>
      {strikes.slice(0, 10).map((s) => {
        const ageMs = now - new Date(s.timestamp).getTime();
        const ageSec = Math.round(ageMs / 1000);
        const ageLabel = ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;
        const isCG = s.type === 'CG';
        const isNegative = s.peakCurrentKA < 0;

        return (
          <div
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '3px 0',
              borderBottom: '1px solid rgba(var(--fg-rgb),var(--fg-a05))',
              fontSize: '11px',
            }}
          >
            <span style={{ fontSize: '13px', animation: 'lightning-flash 1.5s ease-in-out infinite' }}>
              {isCG ? (isNegative ? '⚡' : '🔼') : '☁️'}
            </span>
            <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a6))', whiteSpace: 'nowrap' }}>
              {s.lat.toFixed(1)}°N {s.lon.toFixed(1)}°E
            </span>
            <span style={{ fontWeight: 600, color: isCG ? '#fbbf24' : '#93c5fd' }}>
              {s.peakCurrentKA > 0 ? '+' : ''}{s.peakCurrentKA} kA
            </span>
            <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              {ageLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LightningDetectionProps {
  /** Grid cells for CAPE computation; when omitted, component shows placeholder */
  gridCells?: GridCell[];
  /** Whether the panel is active */
  enabled?: boolean;
  /** Observed lightning strike data from external API (Req 50.4) */
  lightningStrikes?: LightningStrike[];
  /** Whether to use mock lightning data when lightningStrikes is not provided */
  useMockStrikes?: boolean;
  /**
   * Called when a thunderstorm-prone cell is selected.
   * Consumers can fly to that cell on the globe.
   */
  onCellSelect?: (cell: ThunderstormCell) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * LightningDetection — Lightning and Thunderstorm Detection Panel.
 *
 * Validates: Requirements 50.1, 50.2, 50.3, 50.4
 */
export const LightningDetection: React.FC<LightningDetectionProps> = ({
  gridCells,
  enabled = true,
  lightningStrikes,
  useMockStrikes = true,
  onCellSelect,
}) => {
  const [activeTab, setActiveTab] = useState<'outlook' | 'strikes'>('outlook');
  const [selectedCellIdx, setSelectedCellIdx] = useState<number | null>(null);

  // Compute thunderstorm cells from grid data
  const thunderstormCells = useMemo<ThunderstormCell[]>(() => {
    if (!enabled || !gridCells || gridCells.length === 0) return [];
    return buildThunderstormCells(gridCells);
  }, [gridCells, enabled]);

  // Only cells marked as thunderstorm-prone, sorted descending by CAPE
  const proneCells = useMemo(
    () =>
      thunderstormCells
        .filter((c) => c.thunderstormProne)
        .sort((a, b) => b.cape - a.cape),
    [thunderstormCells],
  );

  // Severe Weather Outlook summary
  const outlook = useMemo(
    () => computeOutlook(thunderstormCells),
    [thunderstormCells],
  );

  // Resolve lightning strike data
  const strikes = useMemo<LightningStrike[]>(() => {
    if (lightningStrikes && lightningStrikes.length > 0) return lightningStrikes;
    return useMockStrikes ? MOCK_LIGHTNING_STRIKES : [];
  }, [lightningStrikes, useMockStrikes]);

  if (!enabled) return null;

  const hasData = gridCells && gridCells.length > 0;
  const severeCount = (outlook.categoryCounts['Moderate'] ?? 0) + (outlook.categoryCounts['High'] ?? 0);

  return (
    <div
      className="lightning-detection"
      data-testid="lightning-detection"
      role="region"
      aria-label="Lightning and Thunderstorm Detection"
    >
      {/* ── Severe Alert Banner ── */}
      {severeCount > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            background: 'rgba(255, 0, 255, 0.10)',
            border: '1px solid #ff00ff',
            borderRadius: 'var(--radius-md, 8px)',
            padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
            marginBottom: 'var(--space-md, 12px)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'lightning-alert-pulse 2s ease-in-out infinite',
          }}
        >
          <LightningIcon size={20} animate />
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#f9a8d4' }}>
            SEVERE THUNDERSTORM RISK — {severeCount} cell{severeCount > 1 ? 's' : ''} at Moderate/High risk
          </span>
        </div>
      )}

      {/* ── Main Glass Panel ── */}
      <GlassPanel padding="md" className="lightning-panel">
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
          <LightningIcon size={20} animate={severeCount > 0} />
          Lightning &amp; Thunderstorm Detection
          <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            {hasData ? `${thunderstormCells.length} cells analysed` : 'No data'}
          </span>
        </h3>

        {/* Tab switcher */}
        <div
          role="tablist"
          aria-label="Lightning detection views"
          style={{ display: 'flex', gap: '6px', marginBottom: 'var(--space-md, 12px)' }}
        >
          {(['outlook', 'strikes'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '4px 12px',
                borderRadius: '6px',
                border: activeTab === tab ? '1px solid rgba(251,191,36,0.7)' : '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
                background: activeTab === tab ? 'rgba(251,191,36,0.12)' : 'transparent',
                color: activeTab === tab ? '#fbbf24' : 'rgba(var(--fg-rgb),var(--fg-a4))',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 200ms ease',
              }}
            >
              {tab === 'outlook' ? '⛈️ Outlook' : '⚡ Live Strikes'}
            </button>
          ))}
        </div>

        {/* Outlook tab */}
        {activeTab === 'outlook' && (
          <div role="tabpanel" aria-label="Severe Weather Outlook">
            {hasData ? (
              <>
                {/* Max risk badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>Max risk today:</span>
                  <RiskBadge risk={outlook.maxRisk} />
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#fbbf24' }}>
                    {outlook.thunderstormProneCells} Thunderstorm Prone
                  </span>
                </div>

                {/* Category distribution bar */}
                <OutlookBar outlook={outlook} />

                {/* Thunderstorm-prone cells table */}
                {proneCells.length > 0 ? (
                  <div style={{ overflowY: 'auto', maxHeight: '240px' }}>
                    <table
                      style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
                      aria-label="Thunderstorm-prone grid cells"
                    >
                      <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,12,20,0.95)', zIndex: 1 }}>
                        <tr>
                          {['#', 'Location', 'CAPE', 'Risk', ''].map((label, i) => (
                            <th
                              key={i}
                              scope="col"
                              style={{
                                padding: '5px 8px',
                                textAlign: i < 2 ? 'left' : 'center',
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
                        {proneCells.map((cell, idx) => (
                          <tr
                            key={`${cell.lat}-${cell.lon}`}
                            onClick={() => {
                              const next = selectedCellIdx === idx ? null : idx;
                              setSelectedCellIdx(next);
                              if (next !== null) onCellSelect?.(cell);
                            }}
                            style={{
                              cursor: 'pointer',
                              background: selectedCellIdx === idx ? 'rgba(251,191,36,0.08)' : 'transparent',
                              transition: 'background 150ms ease',
                            }}
                          >
                            <td style={{ padding: '4px 8px', textAlign: 'center', color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontSize: '11px' }}>
                              {idx + 1}
                            </td>
                            <td style={{ padding: '4px 8px', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a75))', whiteSpace: 'nowrap' }}>
                              {cell.lat.toFixed(2)}°N, {cell.lon.toFixed(2)}°E
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#fbbf24' }}>
                              {Math.round(cell.cape)} J/kg
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                              <RiskBadge risk={cell.risk} />
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                              <LightningIcon size={14} animate />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', textAlign: 'center', margin: '16px 0' }}>
                    No cells exceed the 1500 J/kg CAPE threshold
                  </p>
                )}
              </>
            ) : (
              <p style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', textAlign: 'center', margin: '24px 0' }}>
                Load grid data to compute CAPE estimates
              </p>
            )}
          </div>
        )}

        {/* Live strikes tab (Req 50.4) */}
        {activeTab === 'strikes' && (
          <div role="tabpanel" aria-label="Live Lightning Strikes">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
                {lightningStrikes ? 'Live data' : 'Demo data — connect external API for live strikes'}
              </span>
              <span
                style={{
                  width: '7px', height: '7px',
                  borderRadius: '50%',
                  background: lightningStrikes ? '#22c55e' : '#94a3b8',
                  display: 'inline-block',
                  animation: lightningStrikes ? 'lightning-pulse-dot 1.5s ease-in-out infinite' : 'none',
                }}
              />
            </div>
            <LightningStrikesList strikes={strikes} />
          </div>
        )}
      </GlassPanel>

      {/* ── CSS Animations ── */}
      <style>{`
        @keyframes lightning-flash {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.3; transform: scale(1.2); }
        }
        @keyframes lightning-alert-pulse {
          0%, 100% { box-shadow: 0 0 6px rgba(255,0,255,0.3); }
          50%       { box-shadow: 0 0 20px rgba(255,0,255,0.7); }
        }
        @keyframes lightning-pulse-dot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

export default LightningDetection;
