/**
 * ClimateChangeProjection — Climate Change Projection Mode.
 *
 * Exports pure functions for RCP scenario interpolation and anomaly
 * computation (testable), plus a React component rendering:
 *  1. Projection scenario selector (RCP 4.5 / RCP 8.5 × 2030/2040/2050)
 *  2. Anomaly maps showing departure from the 2010–2020 baseline
 *  3. "Time Machine" slider for smooth interpolation between present & future
 *  4. Vulnerability zone overlay appropriate to each timeframe
 *
 * Validates: Requirements 42.1, 42.2, 42.3, 42.4
 */

import React, { useMemo, useState, useCallback } from 'react';
import { GlassPanel } from '../../design-system';
import type { VariableId } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Supported Representative Concentration Pathway scenarios */
export type RCPScenario = 'rcp45' | 'rcp85';

/** Projection horizon years */
export type ProjectionYear = 2030 | 2040 | 2050;

/** A grid cell anomaly departure from the 2010–2020 baseline */
export interface AnomalyCell {
  lat: number;
  lon: number;
  /** Absolute departure in original variable units */
  absoluteDelta: number;
  /** Percentage departure from baseline mean */
  percentDelta: number;
  /** The baseline mean value for this cell */
  baselineMean: number;
}

/** Vulnerability zone category */
export type VulnerabilityType =
  | 'coastal_erosion'
  | 'glacier_melt'
  | 'desertification'
  | 'flood_plain';

/** A vulnerability zone polygon for overlay */
export interface VulnerabilityZone {
  id: string;
  type: VulnerabilityType;
  label: string;
  /** Bounding lat/lon extent [south, west, north, east] */
  extent: [number, number, number, number];
  /** Year from which this zone becomes active */
  activeFromYear: ProjectionYear;
}

/** Scalar projection values per RCP × year × variable */
export interface ProjectionScenarioData {
  rcp: RCPScenario;
  year: ProjectionYear;
  /** Mean delta applied to all cells (representative signal) */
  rainfallDeltaPct: number; // % change from baseline
  tempMaxDeltaC: number;    // °C change
  tempMinDeltaC: number;    // °C change
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Labels for each RCP scenario */
export const RCP_LABELS: Record<RCPScenario, string> = {
  rcp45: 'RCP 4.5 — Moderate Mitigation',
  rcp85: 'RCP 8.5 — Business As Usual',
};

/** IPCC AR6-aligned projection data for All-India mean climate signal.
 *  Sources: IPCC AR6 WGI SPM, IMD climate projections over India.
 *  These represent ensemble-median changes from the 1995–2014 baseline.
 *  We map from 2010–2020 baseline by applying minor offset (-0.5°C / -2% rainfall).
 */
export const PROJECTION_SCENARIOS: ProjectionScenarioData[] = [
  { rcp: 'rcp45', year: 2030, rainfallDeltaPct:  3, tempMaxDeltaC: 0.8,  tempMinDeltaC: 0.7  },
  { rcp: 'rcp45', year: 2040, rainfallDeltaPct:  5, tempMaxDeltaC: 1.2,  tempMinDeltaC: 1.1  },
  { rcp: 'rcp45', year: 2050, rainfallDeltaPct:  7, tempMaxDeltaC: 1.5,  tempMinDeltaC: 1.4  },
  { rcp: 'rcp85', year: 2030, rainfallDeltaPct:  4, tempMaxDeltaC: 1.0,  tempMinDeltaC: 0.9  },
  { rcp: 'rcp85', year: 2040, rainfallDeltaPct:  6, tempMaxDeltaC: 1.6,  tempMinDeltaC: 1.5  },
  { rcp: 'rcp85', year: 2050, rainfallDeltaPct: 10, tempMaxDeltaC: 2.4,  tempMinDeltaC: 2.2  },
];

/** Vulnerability zones active for each projection timeframe.
 *  Validates: Requirement 42.4
 */
export const VULNERABILITY_ZONES: VulnerabilityZone[] = [
  {
    id: 'coastal-lakshadweep',
    type: 'coastal_erosion',
    label: 'Lakshadweep Coastal Erosion Risk',
    extent: [8.0, 71.0, 12.5, 74.5],
    activeFromYear: 2030,
  },
  {
    id: 'coastal-sundarbans',
    type: 'coastal_erosion',
    label: 'Sundarbans Erosion & Sea Level Rise',
    extent: [21.5, 88.0, 23.0, 89.5],
    activeFromYear: 2030,
  },
  {
    id: 'glacier-himachal',
    type: 'glacier_melt',
    label: 'Himachal Glacier Retreat Zone',
    extent: [31.5, 76.0, 33.5, 79.0],
    activeFromYear: 2030,
  },
  {
    id: 'glacier-uttarakhand',
    type: 'glacier_melt',
    label: 'Uttarakhand Glacier Melt Front',
    extent: [30.0, 78.5, 31.5, 80.5],
    activeFromYear: 2030,
  },
  {
    id: 'glacier-kashmir',
    type: 'glacier_melt',
    label: 'Kashmir Siachen Melt Acceleration',
    extent: [34.5, 76.5, 36.5, 78.0],
    activeFromYear: 2040,
  },
  {
    id: 'desert-rajasthan',
    type: 'desertification',
    label: 'Rajasthan Desertification Front',
    extent: [24.0, 69.5, 28.5, 74.5],
    activeFromYear: 2040,
  },
  {
    id: 'desert-kutch',
    type: 'desertification',
    label: 'Kutch Dryland Expansion',
    extent: [22.5, 68.0, 24.5, 71.5],
    activeFromYear: 2050,
  },
  {
    id: 'flood-assam',
    type: 'flood_plain',
    label: 'Assam Brahmaputra Flood Plain',
    extent: [25.5, 90.0, 27.5, 96.0],
    activeFromYear: 2030,
  },
  {
    id: 'flood-bihar',
    type: 'flood_plain',
    label: 'Bihar Flood Plain Expansion',
    extent: [24.5, 84.0, 27.0, 88.0],
    activeFromYear: 2040,
  },
];

/** Colors for each vulnerability zone type */
export const VULNERABILITY_COLORS: Record<VulnerabilityType, string> = {
  coastal_erosion:  '#38bdf8', // sky-400
  glacier_melt:     '#a5f3fc', // cyan-200
  desertification:  '#fbbf24', // amber-400
  flood_plain:      '#60a5fa', // blue-400
};

/** Present-day year anchor for interpolation */
export const BASELINE_END_YEAR = 2020;
export const CURRENT_YEAR = 2024;

// ── Pure Functions (exported for testing) ─────────────────────────────────────

/**
 * Look up the projection scenario data for a given RCP and year.
 * Returns undefined when no matching entry exists.
 */
export function getProjectionData(
  rcp: RCPScenario,
  year: ProjectionYear,
): ProjectionScenarioData | undefined {
  return PROJECTION_SCENARIOS.find((s) => s.rcp === rcp && s.year === year);
}

/**
 * Linearly interpolate between the present-day signal (t=0) and a
 * future projection (t=1) using the Time Machine fraction.
 *
 * For t ∈ [0, 1]:
 *   interpolated = present + t × (future − present)
 *
 * Validates: Requirement 42.3 (smooth interpolation between present & future)
 *
 * @param presentValue  Current value (baseline, t=0)
 * @param futureValue   Projected value at t=1
 * @param fraction      Time Machine position in [0, 1]
 * @returns Interpolated value bounded between min(present, future) and max(present, future)
 */
export function interpolateProjection(
  presentValue: number,
  futureValue: number,
  fraction: number,
): number {
  const t = Math.min(1, Math.max(0, fraction));
  return presentValue + t * (futureValue - presentValue);
}

/**
 * Compute the effective delta for a variable at the current Time Machine
 * position by linearly interpolating from 0 at present to the full
 * scenario delta at t=1.
 *
 * Validates: Requirement 42.2, 42.3
 */
export function computeEffectiveDelta(
  scenarioDelta: number,
  fraction: number,
): number {
  return interpolateProjection(0, scenarioDelta, fraction);
}

/**
 * Compute anomaly cells from a set of baseline cells by applying the
 * effective projected delta (absolute or percentage) for the given variable.
 *
 * For rainfall: delta is applied as a percentage (multiplicative)
 * For temperature: delta is applied as an absolute offset (additive)
 *
 * Validates: Requirement 42.2 (anomaly maps, departure from baseline)
 */
export function computeAnomalyCells(
  baselineCells: Array<{ lat: number; lon: number; value: number }>,
  variable: VariableId,
  effectiveDelta: number, // °C for temp, % for rainfall
): AnomalyCell[] {
  return baselineCells.map((cell) => {
    let absoluteDelta: number;
    let percentDelta: number;

    if (variable === 'rainfall') {
      // effectiveDelta is a percentage change
      absoluteDelta = cell.value * (effectiveDelta / 100);
      percentDelta = effectiveDelta;
    } else {
      // effectiveDelta is in °C
      absoluteDelta = effectiveDelta;
      percentDelta = cell.value !== 0 ? (effectiveDelta / cell.value) * 100 : 0;
    }

    return {
      lat: cell.lat,
      lon: cell.lon,
      absoluteDelta,
      percentDelta,
      baselineMean: cell.value,
    };
  });
}

/**
 * Map a delta value to a diverging anomaly colour.
 * Blue → 0 → Red (negative = cooling/drying, positive = warming/wetting).
 *
 * The scale is normalised to a range of ±maxDelta.
 *
 * Validates: Requirement 42.2
 */
export function anomalyDeltaToColor(delta: number, maxDelta: number): string {
  if (maxDelta === 0) return 'rgb(128,128,128)';
  const t = Math.min(1, Math.max(-1, delta / maxDelta));
  if (t >= 0) {
    // 0 → white, 1 → deep red
    const r = Math.round(255);
    const g = Math.round(255 * (1 - t));
    const b = Math.round(255 * (1 - t));
    return `rgb(${r},${g},${b})`;
  }
  // −1 → deep blue, 0 → white
  const r = Math.round(255 * (1 + t));
  const g = Math.round(255 * (1 + t));
  const b = 255;
  return `rgb(${r},${g},${b})`;
}

/**
 * Filter vulnerability zones that are active for the given projection year.
 * Validates: Requirement 42.4
 */
export function getActiveVulnerabilityZones(
  year: ProjectionYear,
): VulnerabilityZone[] {
  return VULNERABILITY_ZONES.filter((z) => z.activeFromYear <= year);
}

/**
 * Build the label describing the current Time Machine state.
 * At t=0 → "Present (2024)"
 * At t=1 → "2030/2040/2050 Projection"
 * In-between → an interpolated year string.
 */
export function buildTimeMachineLabel(
  fraction: number,
  targetYear: ProjectionYear,
): string {
  if (fraction <= 0) return `Present (${CURRENT_YEAR})`;
  if (fraction >= 1) return `${targetYear} Projection`;
  const year = Math.round(CURRENT_YEAR + fraction * (targetYear - CURRENT_YEAR));
  return `~${year}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Styled badge for RCP label */
const RCPBadge: React.FC<{ rcp: RCPScenario; active: boolean; onClick: () => void }> = ({
  rcp, active, onClick,
}) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    style={{
      padding: '4px 10px',
      borderRadius: 'var(--radius-full, 9999px)',
      border: `1px solid ${active
        ? (rcp === 'rcp45' ? '#22d3ee' : '#f97316')
        : 'rgba(var(--fg-rgb),var(--fg-a2))'}`,
      background: active
        ? (rcp === 'rcp45' ? 'rgba(34,211,238,0.15)' : 'rgba(249,115,22,0.15)')
        : 'transparent',
      color: active
        ? (rcp === 'rcp45' ? '#22d3ee' : '#f97316')
        : 'rgba(var(--fg-rgb),var(--fg-a6))',
      fontSize: 'var(--font-small, 12px)',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 200ms ease',
    }}
  >
    {rcp === 'rcp45' ? 'RCP 4.5' : 'RCP 8.5'}
  </button>
);

/** Year selector pills */
const YearSelector: React.FC<{
  years: ProjectionYear[];
  selected: ProjectionYear;
  onChange: (y: ProjectionYear) => void;
  rcp: RCPScenario;
}> = ({ years, selected, onChange, rcp }) => {
  const accentColor = rcp === 'rcp45' ? '#22d3ee' : '#f97316';
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      {years.map((y) => (
        <button
          key={y}
          onClick={() => onChange(y)}
          aria-pressed={selected === y}
          style={{
            flex: 1,
            padding: '5px 0',
            borderRadius: 'var(--radius-sm, 6px)',
            border: `1px solid ${selected === y ? accentColor : 'rgba(var(--fg-rgb),var(--fg-a15))'}`,
            background: selected === y ? `${accentColor}20` : 'transparent',
            color: selected === y ? accentColor : 'rgba(var(--fg-rgb),var(--fg-a6))',
            fontSize: 'var(--font-small, 12px)',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 200ms ease',
          }}
        >
          {y}
        </button>
      ))}
    </div>
  );
};

/** Delta stat card */
const DeltaStat: React.FC<{ label: string; delta: number; unit: string; color: string }> = ({
  label, delta, unit, color,
}) => (
  <div
    style={{
      background: `${color}12`,
      border: `1px solid ${color}40`,
      borderRadius: 'var(--radius-sm, 6px)',
      padding: '8px 10px',
      textAlign: 'center',
    }}
  >
    <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '3px' }}>
      {label}
    </div>
    <div style={{ fontSize: 'var(--font-heading-sm, 18px)', fontWeight: 700, color }}>
      {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
      <span style={{ fontSize: '11px', marginLeft: '2px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
        {unit}
      </span>
    </div>
  </div>
);

/** Diverging color scale legend */
const DivergingLegend: React.FC<{ variable: VariableId; maxDelta: number }> = ({ variable, maxDelta }) => {
  const unit = variable === 'rainfall' ? '%' : '°C';
  const neg = (-maxDelta).toFixed(1);
  const pos = `+${maxDelta.toFixed(1)}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
      <span>{neg}{unit}</span>
      <div
        aria-hidden="true"
        style={{
          flex: 1, height: '8px', borderRadius: '4px',
          background: 'linear-gradient(to right, #1e40af, #93c5fd, #fff, #fca5a5, #b91c1c)',
        }}
      />
      <span>{pos}{unit}</span>
    </div>
  );
};

/** Vulnerability zone list */
const VulnerabilityList: React.FC<{ zones: VulnerabilityZone[]; year: ProjectionYear }> = ({ zones, year }) => (
  <div style={{ marginTop: 'var(--space-md, 12px)' }}>
    <div style={{
      fontSize: '11px', fontWeight: 600, color: 'rgba(var(--fg-rgb),var(--fg-a4))',
      textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px',
    }}>
      Vulnerability Zones — {year}
      <span style={{ marginLeft: '6px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontWeight: 400 }}>
        ({zones.length} active)
      </span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {zones.map((z) => {
        const color = VULNERABILITY_COLORS[z.type];
        const icon = z.type === 'coastal_erosion' ? '🌊'
          : z.type === 'glacier_melt' ? '🧊'
          : z.type === 'desertification' ? '🏜️'
          : '💧';
        return (
          <div
            key={z.id}
            role="listitem"
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '5px 8px',
              background: `${color}0d`,
              border: `1px solid ${color}35`,
              borderRadius: 'var(--radius-sm, 6px)',
            }}
          >
            <span aria-hidden="true">{icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a75))', fontWeight: 500 }}>
                {z.label}
              </div>
              <div style={{ fontSize: '10px', color: color, marginTop: '1px', textTransform: 'capitalize' }}>
                {z.type.replace(/_/g, ' ')}
                {z.activeFromYear < year && (
                  <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginLeft: '6px' }}>
                    Active since {z.activeFromYear}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {zones.length === 0 && (
        <div style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontStyle: 'italic' }}>
          No vulnerability zones for this selection
        </div>
      )}
    </div>
  </div>
);

// ── Component Props ───────────────────────────────────────────────────────────

export interface ClimateChangeProjectionProps {
  /** Currently selected variable for anomaly mapping */
  variable?: VariableId;
  /** Whether this panel is visible */
  enabled?: boolean;
  /**
   * Callback when Time Machine fraction changes (0=present, 1=future).
   * Globe layers can use this to apply interpolated overlay.
   */
  onTimeMachineChange?: (fraction: number, scenario: ProjectionScenarioData) => void;
  /**
   * Callback when active vulnerability zones change.
   * Globe layers can use this to render zone overlays.
   */
  onVulnerabilityZonesChange?: (zones: VulnerabilityZone[]) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

const PROJECTION_YEARS: ProjectionYear[] = [2030, 2040, 2050];

/**
 * ClimateChangeProjection — Climate Change Projection Mode panel.
 *
 * Validates: Requirements 42.1, 42.2, 42.3, 42.4
 */
export const ClimateChangeProjection: React.FC<ClimateChangeProjectionProps> = ({
  variable = 'rainfall',
  enabled = true,
  onTimeMachineChange,
  onVulnerabilityZonesChange,
}) => {
  const [selectedRcp, setSelectedRcp] = useState<RCPScenario>('rcp45');
  const [selectedYear, setSelectedYear] = useState<ProjectionYear>(2050);
  const [timeFraction, setTimeFraction] = useState<number>(1);

  // Active scenario data
  const scenarioData = useMemo(
    () => getProjectionData(selectedRcp, selectedYear),
    [selectedRcp, selectedYear],
  );

  // Effective deltas scaled by Time Machine position
  const effectiveDeltas = useMemo(() => {
    if (!scenarioData) return { rainfall: 0, tempMax: 0, tempMin: 0 };
    return {
      rainfall: computeEffectiveDelta(scenarioData.rainfallDeltaPct, timeFraction),
      tempMax: computeEffectiveDelta(scenarioData.tempMaxDeltaC, timeFraction),
      tempMin: computeEffectiveDelta(scenarioData.tempMinDeltaC, timeFraction),
    };
  }, [scenarioData, timeFraction]);

  // Vulnerability zones for this year
  const activeZones = useMemo(
    () => getActiveVulnerabilityZones(selectedYear),
    [selectedYear],
  );

  const timeMachineLabel = useMemo(
    () => buildTimeMachineLabel(timeFraction, selectedYear),
    [timeFraction, selectedYear],
  );

  const accentColor = selectedRcp === 'rcp45' ? '#22d3ee' : '#f97316';

  const handleTimeFractionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const frac = parseFloat(e.target.value);
      setTimeFraction(frac);
      if (scenarioData) onTimeMachineChange?.(frac, scenarioData);
      onVulnerabilityZonesChange?.(activeZones);
    },
    [scenarioData, activeZones, onTimeMachineChange, onVulnerabilityZonesChange],
  );

  const handleRcpChange = (rcp: RCPScenario) => {
    setSelectedRcp(rcp);
    const data = getProjectionData(rcp, selectedYear);
    if (data) onTimeMachineChange?.(timeFraction, data);
  };

  const handleYearChange = (year: ProjectionYear) => {
    setSelectedYear(year);
    const zones = getActiveVulnerabilityZones(year);
    onVulnerabilityZonesChange?.(zones);
    const data = getProjectionData(selectedRcp, year);
    if (data) onTimeMachineChange?.(timeFraction, data);
  };

  if (!enabled) return null;

  return (
    <div
      className="climate-change-projection"
      data-testid="climate-change-projection"
      role="region"
      aria-label="Climate Change Projection Mode"
    >
      <GlassPanel padding="md">
        {/* ── Header ── */}
        <h3 style={{
          margin: '0 0 var(--space-md, 12px) 0',
          fontSize: 'var(--font-heading-sm, 18px)',
          fontWeight: 600,
          color: 'rgba(var(--fg-rgb),var(--fg-a75))',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          🔭 Climate Change Projections
          <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
            IPCC AR6
          </span>
        </h3>

        {/* ── RCP Scenario Selector (Req 42.1) ── */}
        <div style={{ marginBottom: 'var(--space-md, 12px)' }}>
          <div style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Emission Scenario
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <RCPBadge rcp="rcp45" active={selectedRcp === 'rcp45'} onClick={() => handleRcpChange('rcp45')} />
            <RCPBadge rcp="rcp85" active={selectedRcp === 'rcp85'} onClick={() => handleRcpChange('rcp85')} />
          </div>
          <div style={{ marginTop: '5px', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
            {RCP_LABELS[selectedRcp]}
          </div>
        </div>

        {/* ── Projection Year Selector (Req 42.1) ── */}
        <div style={{ marginBottom: 'var(--space-md, 12px)' }}>
          <div style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Projection Horizon
          </div>
          <YearSelector
            years={PROJECTION_YEARS}
            selected={selectedYear}
            onChange={handleYearChange}
            rcp={selectedRcp}
          />
        </div>

        {/* ── Projected Deltas summary (Req 42.2) ── */}
        {scenarioData && (
          <div style={{ marginBottom: 'var(--space-md, 12px)' }}>
            <div style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Projected Changes vs 2010–2020 Baseline
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              <DeltaStat
                label="Rainfall"
                delta={effectiveDeltas.rainfall}
                unit="%"
                color={effectiveDeltas.rainfall >= 0 ? '#60a5fa' : '#fbbf24'}
              />
              <DeltaStat
                label="Max Temp"
                delta={effectiveDeltas.tempMax}
                unit="°C"
                color="#f97316"
              />
              <DeltaStat
                label="Min Temp"
                delta={effectiveDeltas.tempMin}
                unit="°C"
                color="#fb923c"
              />
            </div>
            <DivergingLegend variable={variable} maxDelta={
              variable === 'rainfall'
                ? Math.abs(scenarioData.rainfallDeltaPct)
                : Math.abs(scenarioData.tempMaxDeltaC)
            } />
          </div>
        )}

        {/* ── Time Machine Slider (Req 42.3) ── */}
        <div style={{ marginBottom: 'var(--space-md, 12px)' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}>
            <div style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              ⏳ Time Machine
            </div>
            <div style={{
              fontSize: '13px',
              fontWeight: 700,
              color: accentColor,
              background: `${accentColor}18`,
              border: `1px solid ${accentColor}50`,
              borderRadius: 'var(--radius-full, 9999px)',
              padding: '2px 10px',
            }}>
              {timeMachineLabel}
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={timeFraction}
            onChange={handleTimeFractionChange}
            aria-label="Time Machine: interpolate between present and future projection"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={timeFraction}
            aria-valuetext={timeMachineLabel}
            style={{
              width: '100%',
              accentColor,
              cursor: 'pointer',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginTop: '2px' }}>
            <span>Present ({CURRENT_YEAR})</span>
            <span>{selectedYear}</span>
          </div>
        </div>

        {/* ── Vulnerability Zones (Req 42.4) ── */}
        <VulnerabilityList zones={activeZones} year={selectedYear} />
      </GlassPanel>

      {/* ── CSS Animations ── */}
      <style>{`
        .climate-change-projection input[type="range"] {
          -webkit-appearance: none;
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(
            to right,
            ${accentColor} 0%,
            ${accentColor} ${timeFraction * 100}%,
            rgba(var(--fg-rgb),var(--fg-a15)) ${timeFraction * 100}%,
            rgba(var(--fg-rgb),var(--fg-a15)) 100%
          );
        }
        .climate-change-projection input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: ${accentColor};
          border: 2px solid rgba(0,0,0,0.4);
          cursor: pointer;
          box-shadow: 0 0 8px ${accentColor}80;
          transition: transform 150ms ease, box-shadow 150ms ease;
        }
        .climate-change-projection input[type="range"]::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          box-shadow: 0 0 14px ${accentColor};
        }
        .climate-change-projection input[type="range"]::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: ${accentColor};
          border: 2px solid rgba(0,0,0,0.4);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

export default ClimateChangeProjection;
