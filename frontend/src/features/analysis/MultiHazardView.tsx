/**
 * MultiHazardView — Multi-Hazard Early Warning Composite.
 *
 * Exports pure functions for compound risk computation and alert escalation
 * (testable), plus a React component overlaying all active hazard warnings
 * simultaneously with severity icons, a 72-hour Daily Hazard Bulletin, and
 * compound risk indicators for spatially-overlapping hazards.
 *
 * Validates: Requirements 53.1, 53.2, 53.3, 53.4
 */

import React, { useMemo, useCallback, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, RegionId } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Supported hazard types tracked by the multi-hazard view */
export type HazardType = 'flood' | 'drought' | 'heatwave' | 'cyclone' | 'aqi' | 'lightning';

/** Alert escalation levels (Req 53.4) */
export type AlertLevel = 'watch' | 'warning' | 'emergency';

/** A single active hazard warning for a grid cell or region */
export interface HazardWarning {
  hazardType: HazardType;
  alertLevel: AlertLevel;
  /** Numeric severity in [0, 100] — used for compound risk computation */
  severity: number;
  lat: number;
  lon: number;
  /** Optional human-readable description */
  description?: string;
}

/** Compound risk assessment for a spatially-overlapping location */
export interface CompoundRiskCell {
  lat: number;
  lon: number;
  /** All hazards active at this location */
  hazards: HazardWarning[];
  /** Compound risk score [0, 100] */
  compoundScore: number;
  /** Escalated alert level based on compound severity */
  compoundAlertLevel: AlertLevel;
}

/** A single entry in the 72-hour Daily Hazard Bulletin (Req 53.2) */
export interface BulletinEntry {
  /** Hour offset from now: 0, 6, 12, 24, 48, 72 */
  hourOffset: number;
  label: string;
  hazards: { type: HazardType; alertLevel: AlertLevel; affectedCount: number }[];
  overallAlertLevel: AlertLevel;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Severity icon for each hazard type (Req 53.1) */
export const HAZARD_ICONS: Record<HazardType, string> = {
  flood:     '🌊',
  drought:   '🏜️',
  heatwave:  '🌡️',
  cyclone:   '🌀',
  aqi:       '😷',
  lightning: '⚡',
};

/** Display label for each hazard */
export const HAZARD_LABELS: Record<HazardType, string> = {
  flood:     'Flood',
  drought:   'Drought',
  heatwave:  'Heat Wave',
  cyclone:   'Cyclone',
  aqi:       'Air Quality',
  lightning: 'Lightning',
};

/** Alert level colors (Req 53.4: Watch → Warning → Emergency) */
export const ALERT_COLORS: Record<AlertLevel, string> = {
  watch:     '#f59e0b', // amber
  warning:   '#f97316', // orange
  emergency: '#ef4444', // red
};

/** Alert level numeric rank (higher = more severe) */
export const ALERT_RANK: Record<AlertLevel, number> = {
  watch:     1,
  warning:   2,
  emergency: 3,
};

/** Severity thresholds driving alert escalation (Req 53.4) */
export const ALERT_ESCALATION_THRESHOLDS = {
  /** Combined score to trigger a Watch */
  WATCH: 30,
  /** Combined score to trigger a Warning */
  WARNING: 60,
  /** Combined score to trigger an Emergency */
  EMERGENCY: 80,
} as const;

/** Spatial proximity (degrees) to consider two cells overlapping (Req 53.3) */
export const OVERLAP_TOLERANCE_DEG = 0.5;

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Determine the escalated AlertLevel for a given compound severity score.
 *
 * - 'emergency' if score ≥ EMERGENCY threshold
 * - 'warning'   if score ≥ WARNING  threshold
 * - 'watch'     if score ≥ WATCH    threshold
 * - 'watch'     as minimum when at least one hazard is present
 *
 * Validates: Requirement 53.4
 */
export function escalateAlertLevel(compoundScore: number): AlertLevel {
  if (compoundScore >= ALERT_ESCALATION_THRESHOLDS.EMERGENCY) return 'emergency';
  if (compoundScore >= ALERT_ESCALATION_THRESHOLDS.WARNING) return 'warning';
  return 'watch';
}

/**
 * Compute the compound risk score for a set of co-located hazards.
 *
 * Uses a combination formula: base score is the maximum individual severity,
 * boosted by a synergy term (each additional hazard adds 10% of its severity).
 * Result is clamped to [0, 100].
 *
 * Validates: Requirement 53.3
 */
export function computeCompoundScore(warnings: HazardWarning[]): number {
  if (warnings.length === 0) return 0;

  const sorted = [...warnings].sort((a, b) => b.severity - a.severity);
  const maxSeverity = sorted[0].severity;

  // Additional hazards contribute a synergy bonus
  const synergy = sorted
    .slice(1)
    .reduce((sum, w) => sum + w.severity * 0.1, 0);

  return Math.min(100, Math.round(maxSeverity + synergy));
}

/**
 * Group hazard warnings by spatial proximity and compute compound risk for
 * cells where multiple hazards spatially overlap (Req 53.3).
 *
 * Two warnings are considered co-located if their lat/lon difference is both
 * within OVERLAP_TOLERANCE_DEG degrees.
 */
export function computeCompoundRiskCells(
  warnings: HazardWarning[],
): CompoundRiskCell[] {
  if (warnings.length === 0) return [];

  // Cluster by rounded lat/lon bucket (quantized to OVERLAP_TOLERANCE_DEG)
  const bucket = (v: number) =>
    Math.round(v / OVERLAP_TOLERANCE_DEG) * OVERLAP_TOLERANCE_DEG;

  const clusters = new Map<string, HazardWarning[]>();
  for (const w of warnings) {
    const key = `${bucket(w.lat).toFixed(2)},${bucket(w.lon).toFixed(2)}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(w);
  }

  const cells: CompoundRiskCell[] = [];
  for (const [key, group] of clusters) {
    const [latStr, lonStr] = key.split(',');
    const compoundScore = computeCompoundScore(group);
    cells.push({
      lat: parseFloat(latStr),
      lon: parseFloat(lonStr),
      hazards: group,
      compoundScore,
      compoundAlertLevel: escalateAlertLevel(compoundScore),
    });
  }

  // Sort descending by compound score
  return cells.sort((a, b) => b.compoundScore - a.compoundScore);
}

/**
 * Generate a 72-hour Daily Hazard Bulletin from an array of active warnings.
 *
 * Produces time-slot entries at hour offsets: 0, 6, 12, 24, 48, 72.
 * Each slot's hazards include forecasted count (simulated as fraction of active
 * warnings scaled by a decay model; real backends would supply per-slot data).
 *
 * Validates: Requirement 53.2
 */
export function generateHazardBulletin(
  warnings: HazardWarning[],
  now: Date = new Date(),
): BulletinEntry[] {
  const hourSlots = [0, 6, 12, 24, 48, 72];

  // Decay factor per slot: hazard counts reduce slightly over time
  const decayFactor = (hourOffset: number): number => {
    if (hourOffset === 0)  return 1.0;
    if (hourOffset <= 12)  return 0.95;
    if (hourOffset <= 24)  return 0.85;
    if (hourOffset <= 48)  return 0.70;
    return 0.55;
  };

  const slotLabel = (hourOffset: number): string => {
    const d = new Date(now.getTime() + hourOffset * 3_600_000);
    if (hourOffset === 0) return 'Now';
    const hh = d.getHours().toString().padStart(2, '0');
    const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    return `${day} ${hh}:00`;
  };

  // Count per hazard type across all active warnings
  const hazardCounts = new Map<HazardType, { max: AlertLevel; count: number }>();
  for (const w of warnings) {
    const existing = hazardCounts.get(w.hazardType);
    if (!existing) {
      hazardCounts.set(w.hazardType, { max: w.alertLevel, count: 1 });
    } else {
      const maxLevel =
        ALERT_RANK[w.alertLevel] > ALERT_RANK[existing.max]
          ? w.alertLevel
          : existing.max;
      hazardCounts.set(w.hazardType, { max: maxLevel, count: existing.count + 1 });
    }
  }

  return hourSlots.map((hourOffset) => {
    const decay = decayFactor(hourOffset);
    const slotHazards = Array.from(hazardCounts.entries()).map(([type, info]) => ({
      type,
      alertLevel: info.max,
      affectedCount: Math.max(1, Math.round(info.count * decay)),
    }));

    // Overall alert level for this slot = highest individual alert level
    const overallAlertLevel: AlertLevel =
      slotHazards.reduce<AlertLevel>((max, h) => {
        return ALERT_RANK[h.alertLevel] > ALERT_RANK[max] ? h.alertLevel : max;
      }, 'watch');

    return {
      hourOffset,
      label: slotLabel(hourOffset),
      hazards: slotHazards,
      overallAlertLevel,
    };
  });
}

/**
 * Derive active hazard warnings from raw grid cell data, given thresholds.
 * This helper converts climate model outputs into HazardWarning objects for
 * the multi-hazard view.
 */
export interface HazardThresholds {
  floodRainfallMm: number;    // 3-day cumulative mm to trigger flood warning
  heatwaveTempC: number;      // temp_max °C for heatwave warning
  lightningCapeJKg: number;   // simulated CAPE proxy (using temp delta) for lightning
}

export const DEFAULT_HAZARD_THRESHOLDS: HazardThresholds = {
  floodRainfallMm: 100,
  heatwaveTempC: 40,
  lightningCapeJKg: 1500,
};

export function deriveWarningsFromGridCells(
  gridCells: GridCell[],
  thresholds: HazardThresholds = DEFAULT_HAZARD_THRESHOLDS,
): HazardWarning[] {
  const warnings: HazardWarning[] = [];

  for (const cell of gridCells) {
    // Flood: heavy rainfall
    if (cell.rainfall > thresholds.floodRainfallMm) {
      const excess = cell.rainfall - thresholds.floodRainfallMm;
      const severity = Math.min(100, Math.round((excess / thresholds.floodRainfallMm) * 100));
      warnings.push({
        hazardType: 'flood',
        alertLevel: escalateAlertLevel(severity),
        severity,
        lat: cell.lat,
        lon: cell.lon,
        description: `Rainfall ${cell.rainfall.toFixed(1)} mm exceeds flood threshold`,
      });
    }

    // Heat wave: high max temperature
    if (cell.temp_max > thresholds.heatwaveTempC) {
      const excess = cell.temp_max - thresholds.heatwaveTempC;
      const severity = Math.min(100, Math.round((excess / 10) * 100));
      warnings.push({
        hazardType: 'heatwave',
        alertLevel: escalateAlertLevel(severity),
        severity,
        lat: cell.lat,
        lon: cell.lon,
        description: `Temp max ${cell.temp_max.toFixed(1)} °C — heat wave conditions`,
      });
    }

    // Lightning: high diurnal temp range as CAPE proxy
    const diurnal = cell.temp_max - cell.temp_min;
    const capeProxy = diurnal * 100; // crude proxy
    if (capeProxy > thresholds.lightningCapeJKg) {
      const severity = Math.min(100, Math.round((capeProxy / 3000) * 100));
      warnings.push({
        hazardType: 'lightning',
        alertLevel: escalateAlertLevel(severity),
        severity,
        lat: cell.lat,
        lon: cell.lon,
        description: `High CAPE proxy (${capeProxy.toFixed(0)} J/kg) — thunderstorm risk`,
      });
    }
  }

  return warnings;
}

// ── Bulletin PDF Export ──────────────────────────────────────────────────────

/**
 * Export Daily Hazard Bulletin as a print-ready HTML/PDF document (Req 53.2).
 */
export function exportHazardBulletin(
  bulletin: BulletinEntry[],
  compoundCells: CompoundRiskCell[],
  region: RegionId,
  issuedAt: Date = new Date(),
): void {
  const regionLabel = region.replace(/_/g, ' ').toUpperCase();
  const dateStr = issuedAt.toUTCString();

  const slotRows = bulletin
    .map(
      (entry) => `
      <tr>
        <td>${entry.label}</td>
        <td>${entry.hazards.map((h) => `${HAZARD_ICONS[h.type]} ${HAZARD_LABELS[h.type]} (${h.affectedCount})`).join(', ') || '—'}</td>
        <td><span class="badge ${entry.overallAlertLevel}">${entry.overallAlertLevel.toUpperCase()}</span></td>
      </tr>`,
    )
    .join('');

  const compoundRows = compoundCells
    .slice(0, 15)
    .map(
      (c) => `
      <tr>
        <td>${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°</td>
        <td>${c.hazards.map((h) => `${HAZARD_ICONS[h.hazardType]} ${HAZARD_LABELS[h.hazardType]}`).join(', ')}</td>
        <td>${c.compoundScore}</td>
        <td><span class="badge ${c.compoundAlertLevel}">${c.compoundAlertLevel.toUpperCase()}</span></td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Daily Hazard Bulletin — VAYU / MAUSAM</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; color: #111; }
  h1 { color: #b45309; border-bottom: 2px solid #b45309; padding-bottom: 8px; }
  h2 { color: #92400e; margin-top: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #fef3c7; color: #92400e; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px;
           font-size: 11px; font-weight: bold; color: #fff; }
  .watch     { background: #d97706; }
  .warning   { background: #ea580c; }
  .emergency { background: #dc2626; }
  .footer { margin-top: 40px; font-size: 11px; color: #666;
            border-top: 1px solid #ccc; padding-top: 8px; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>🚨 Daily Hazard Bulletin — 72-Hour Outlook</h1>
<p><strong>Region:</strong> ${regionLabel}</p>
<p><strong>Issued:</strong> ${dateStr}</p>
<p><strong>Basis:</strong> VAYU AI model multi-hazard analysis</p>
<h2>72-Hour Hazard Timeline</h2>
<table>
  <thead><tr><th>Time</th><th>Active Hazards</th><th>Alert Level</th></tr></thead>
  <tbody>${slotRows}</tbody>
</table>
<h2>Compound Risk Locations (Top 15)</h2>
${compoundCells.length === 0
  ? '<p>No compound risk locations identified at current thresholds.</p>'
  : `<table>
    <thead><tr><th>Location</th><th>Hazards</th><th>Score (0–100)</th><th>Alert</th></tr></thead>
    <tbody>${compoundRows}</tbody>
  </table>`}
<div class="footer">
  <p>Generated by VAYU / MAUSAM Climate Digital Twin &mdash; ISRO BAH 2025</p>
  <p>Use alongside official IMD / NDMA advisories for operational decisions.</p>
</div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;';
  document.body.appendChild(iframe);
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) { document.body.removeChild(iframe); return; }
  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  setTimeout(() => document.body.removeChild(iframe), 1000);
}

// ── React Component ──────────────────────────────────────────────────────────

export interface MultiHazardViewProps {
  /** Current forecast grid cells (used to derive warnings when no explicit warnings provided) */
  gridCells?: GridCell[];
  /** Externally-provided hazard warnings (overrides grid-cell derivation when supplied) */
  warnings?: HazardWarning[];
  /** Active region, used for PDF export labeling */
  region?: RegionId;
  /** Whether the multi-hazard view is enabled */
  enabled?: boolean;
  /** Custom thresholds for warning derivation */
  thresholds?: HazardThresholds;
}

/**
 * MultiHazardView component.
 *
 * Renders (Req 53.1–53.4):
 * 1. Active warning overlay cards with severity icons per hazard type
 * 2. Compound risk indicator for spatially-overlapping hazards
 * 3. 72-hour Daily Hazard Bulletin timeline
 * 4. Alert level escalation badge (Watch / Warning / Emergency)
 * 5. Export button for Daily Hazard Bulletin PDF
 */
export const MultiHazardView: React.FC<MultiHazardViewProps> = ({
  gridCells = [],
  warnings: externalWarnings,
  region = 'full_india',
  enabled = true,
  thresholds = DEFAULT_HAZARD_THRESHOLDS,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'bulletin' | 'compound'>('overview');

  // Derive or use provided warnings
  const warnings = useMemo<HazardWarning[]>(() => {
    if (!enabled) return [];
    if (externalWarnings) return externalWarnings;
    return deriveWarningsFromGridCells(gridCells, thresholds);
  }, [enabled, externalWarnings, gridCells, thresholds]);

  const compoundCells = useMemo(
    () => computeCompoundRiskCells(warnings),
    [warnings],
  );

  const bulletin = useMemo(
    () => generateHazardBulletin(warnings),
    [warnings],
  );

  // Summary: highest overall alert level
  const overallAlertLevel = useMemo<AlertLevel>(() => {
    if (warnings.length === 0) return 'watch';
    return warnings.reduce<AlertLevel>((max, w) => {
      return ALERT_RANK[w.alertLevel] > ALERT_RANK[max] ? w.alertLevel : max;
    }, 'watch');
  }, [warnings]);

  // Unique hazard types present
  const activeHazardTypes = useMemo(
    () => [...new Set(warnings.map((w) => w.hazardType))],
    [warnings],
  );

  const handleExport = useCallback(() => {
    exportHazardBulletin(bulletin, compoundCells, region);
  }, [bulletin, compoundCells, region]);

  if (!enabled || warnings.length === 0) return null;

  return (
    <div
      className="multi-hazard-view"
      role="region"
      aria-label="Multi-Hazard Early Warning Composite"
    >
      {/* ── Alert Banner ── */}
      <div
        className={`mhv-alert-banner mhv-alert-${overallAlertLevel}`}
        role="alert"
        aria-live="assertive"
        style={{
          background: `${ALERT_COLORS[overallAlertLevel]}18`,
          border: `1px solid ${ALERT_COLORS[overallAlertLevel]}`,
          borderRadius: 'var(--radius-md, 8px)',
          padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
          marginBottom: 'var(--space-md, 12px)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm, 8px)',
          animation: `mhv-pulse-${overallAlertLevel} 2s ease-in-out infinite`,
        }}
      >
        <span style={{ fontSize: '18px' }}>🚨</span>
        <span
          style={{
            fontSize: 'var(--font-body-lg, 16px)',
            color: ALERT_COLORS[overallAlertLevel],
            fontWeight: 'var(--font-weight-semibold, 600)',
          }}
        >
          {warnings.length} Active Hazard Warning{warnings.length !== 1 ? 's' : ''}
        </span>
        <AlertLevelBadge level={overallAlertLevel} />
        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
          }}
        >
          {activeHazardTypes.map((h) => (
            <span key={h} title={HAZARD_LABELS[h]} style={{ fontSize: '16px' }}>
              {HAZARD_ICONS[h]}
            </span>
          ))}
        </span>
      </div>

      {/* ── Main Panel ── */}
      <GlassPanel padding="md" className="mhv-main-panel">
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-md, 12px)',
          }}
        >
          <h3
            style={{
              fontSize: 'var(--font-heading-sm, 18px)',
              fontWeight: 'var(--font-weight-semibold, 600)',
              color: 'rgba(var(--fg-rgb),var(--fg-a75))',
              margin: 0,
            }}
          >
            Multi-Hazard Early Warning
          </h3>
          <button
            onClick={handleExport}
            aria-label="Export Daily Hazard Bulletin as PDF"
            style={{
              background: `${ALERT_COLORS[overallAlertLevel]}22`,
              border: `1px solid ${ALERT_COLORS[overallAlertLevel]}`,
              borderRadius: 'var(--radius-sm, 6px)',
              color: ALERT_COLORS[overallAlertLevel],
              cursor: 'pointer',
              fontSize: 'var(--font-small, 12px)',
              fontWeight: 'var(--font-weight-medium, 500)',
              padding: '4px 10px',
              transition: 'background 200ms var(--ease-standard)',
            }}
          >
            📄 Export Bulletin (PDF)
          </button>
        </div>

        {/* Tab Navigation */}
        <TabNav activeTab={activeTab} onChange={setActiveTab} compoundCount={compoundCells.length} />

        {/* Tab Content */}
        <div style={{ marginTop: 'var(--space-md, 12px)' }}>
          {activeTab === 'overview' && (
            <WarningOverview warnings={warnings} />
          )}
          {activeTab === 'compound' && (
            <CompoundRiskView cells={compoundCells} />
          )}
          {activeTab === 'bulletin' && (
            <BulletinView entries={bulletin} />
          )}
        </div>
      </GlassPanel>

      {/* ── CSS Animations ── */}
      <style>{`
        @keyframes mhv-pulse-watch {
          0%, 100% { box-shadow: 0 0 4px rgba(245,158,11,0.3); }
          50% { box-shadow: 0 0 12px rgba(245,158,11,0.65); }
        }
        @keyframes mhv-pulse-warning {
          0%, 100% { box-shadow: 0 0 5px rgba(249,115,22,0.35); }
          50% { box-shadow: 0 0 14px rgba(249,115,22,0.7); }
        }
        @keyframes mhv-pulse-emergency {
          0%, 100% { box-shadow: 0 0 6px rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 18px rgba(239,68,68,0.85); }
        }
        .mhv-tab-btn {
          background: transparent;
          border: 1px solid rgba(var(--fg-rgb),var(--fg-a1));
          border-radius: var(--radius-sm, 6px);
          color: rgba(var(--fg-rgb),var(--fg-a6));
          cursor: pointer;
          font-size: var(--font-small, 12px);
          font-weight: var(--font-weight-medium, 500);
          padding: 4px 12px;
          transition: all 200ms ease;
        }
        .mhv-tab-btn:hover { color: rgba(var(--fg-rgb),var(--fg-a75)); border-color: rgba(var(--fg-rgb),var(--fg-a2)); }
        .mhv-tab-btn.active {
          background: rgba(var(--fg-rgb),var(--fg-a08));
          border-color: rgba(var(--fg-rgb),var(--fg-a3));
          color: rgba(var(--fg-rgb),var(--fg-a75));
        }
      `}</style>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Alert level badge pill */
const AlertLevelBadge: React.FC<{ level: AlertLevel }> = ({ level }) => (
  <span
    style={{
      background: `${ALERT_COLORS[level]}22`,
      border: `1px solid ${ALERT_COLORS[level]}`,
      borderRadius: 'var(--radius-full, 9999px)',
      color: ALERT_COLORS[level],
      fontSize: 'var(--font-small, 12px)',
      fontWeight: 'var(--font-weight-semibold, 600)',
      padding: '2px 10px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.06em',
    }}
  >
    {level}
  </span>
);

/** Tab navigation bar */
interface TabNavProps {
  activeTab: 'overview' | 'bulletin' | 'compound';
  onChange: (tab: 'overview' | 'bulletin' | 'compound') => void;
  compoundCount: number;
}

const TabNav: React.FC<TabNavProps> = ({ activeTab, onChange, compoundCount }) => (
  <div style={{ display: 'flex', gap: 'var(--space-sm, 8px)' }}>
    {(
      [
        { id: 'overview', label: '⚠ Overview' },
        { id: 'compound', label: `⛔ Compound (${compoundCount})` },
        { id: 'bulletin', label: '📋 72h Bulletin' },
      ] as const
    ).map(({ id, label }) => (
      <button
        key={id}
        className={`mhv-tab-btn${activeTab === id ? ' active' : ''}`}
        onClick={() => onChange(id)}
        aria-selected={activeTab === id}
        role="tab"
      >
        {label}
      </button>
    ))}
  </div>
);

/** Overview: list of individual active warnings grouped by hazard type (Req 53.1) */
const WarningOverview: React.FC<{ warnings: HazardWarning[] }> = ({ warnings }) => {
  // Group by hazard type
  const grouped = useMemo(() => {
    const map = new Map<HazardType, HazardWarning[]>();
    for (const w of warnings) {
      if (!map.has(w.hazardType)) map.set(w.hazardType, []);
      map.get(w.hazardType)!.push(w);
    }
    // Sort groups by highest alert level
    return [...map.entries()].sort((a, b) => {
      const maxLevel = (ws: HazardWarning[]) =>
        ws.reduce((m, w) => (ALERT_RANK[w.alertLevel] > ALERT_RANK[m] ? w.alertLevel : m), 'watch' as AlertLevel);
      return ALERT_RANK[maxLevel(b[1])] - ALERT_RANK[maxLevel(a[1])];
    });
  }, [warnings]);

  return (
    <div
      style={{
        maxHeight: '320px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm, 8px)',
      }}
    >
      {grouped.map(([hazardType, group]) => (
        <HazardTypeCard key={hazardType} hazardType={hazardType} warnings={group} />
      ))}
    </div>
  );
};

/** Card for a single hazard type with its warnings */
interface HazardTypeCardProps {
  hazardType: HazardType;
  warnings: HazardWarning[];
}

const HazardTypeCard: React.FC<HazardTypeCardProps> = ({ hazardType, warnings }) => {
  const maxLevel: AlertLevel = warnings.reduce<AlertLevel>(
    (m, w) => (ALERT_RANK[w.alertLevel] > ALERT_RANK[m] ? w.alertLevel : m),
    'watch',
  );
  const color = ALERT_COLORS[maxLevel];

  return (
    <div
      style={{
        background: `${color}0d`,
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-sm, 6px)',
        padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm, 8px)',
          marginBottom: 'var(--space-xs, 4px)',
        }}
      >
        <span style={{ fontSize: '18px' }}>{HAZARD_ICONS[hazardType]}</span>
        <span
          style={{
            fontSize: 'var(--font-body, 14px)',
            fontWeight: 'var(--font-weight-semibold, 600)',
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            flex: 1,
          }}
        >
          {HAZARD_LABELS[hazardType]}
        </span>
        <AlertLevelBadge level={maxLevel} />
        <span
          style={{
            fontSize: 'var(--font-small, 12px)',
            color: 'rgba(var(--fg-rgb),var(--fg-a4))',
          }}
        >
          {warnings.length} location{warnings.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Top 3 locations */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {warnings
          .sort((a, b) => b.severity - a.severity)
          .slice(0, 3)
          .map((w, i) => (
            <div
              key={i}
              style={{
                fontSize: 'var(--font-small, 12px)',
                color: 'rgba(var(--fg-rgb),var(--fg-a6))',
                paddingLeft: '26px',
              }}
            >
              ({w.lat.toFixed(2)}°, {w.lon.toFixed(2)}°) — severity {w.severity}
              {w.description ? ` — ${w.description}` : ''}
            </div>
          ))}
        {warnings.length > 3 && (
          <div
            style={{
              fontSize: 'var(--font-small, 12px)',
              color: 'rgba(var(--fg-rgb),var(--fg-a3))',
              paddingLeft: '26px',
            }}
          >
            …and {warnings.length - 3} more locations
          </div>
        )}
      </div>
    </div>
  );
};

/** Compound risk view: locations with spatially-overlapping hazards (Req 53.3) */
const CompoundRiskView: React.FC<{ cells: CompoundRiskCell[] }> = ({ cells }) => {
  if (cells.length === 0) {
    return (
      <p style={{ color: 'rgba(var(--fg-rgb),var(--fg-a4))', fontSize: 'var(--font-body, 14px)', textAlign: 'center', padding: '16px 0' }}>
        No spatially-overlapping hazards detected at current thresholds.
      </p>
    );
  }

  return (
    <div
      style={{
        maxHeight: '320px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm, 8px)',
      }}
    >
      {cells.map((cell, idx) => {
        const color = ALERT_COLORS[cell.compoundAlertLevel];
        return (
          <div
            key={idx}
            style={{
              background: `${color}0d`,
              border: `1px solid ${color}`,
              borderRadius: 'var(--radius-sm, 6px)',
              padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              alignItems: 'center',
              gap: 'var(--space-sm, 8px)',
            }}
          >
            <span style={{ fontSize: '18px' }}>⛔</span>
            <div>
              <div style={{ fontSize: 'var(--font-body, 14px)', color: 'rgba(var(--fg-rgb),var(--fg-a75))', fontWeight: 'var(--font-weight-medium, 500)' }}>
                ({cell.lat.toFixed(2)}°, {cell.lon.toFixed(2)}°)
              </div>
              <div style={{ fontSize: 'var(--font-small, 12px)', color: 'rgba(var(--fg-rgb),var(--fg-a6))' }}>
                {cell.hazards.map((h) => `${HAZARD_ICONS[h.hazardType]} ${HAZARD_LABELS[h.hazardType]}`).join(' + ')}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <AlertLevelBadge level={cell.compoundAlertLevel} />
              <div style={{ fontSize: 'var(--font-small, 12px)', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginTop: '3px' }}>
                Score: {cell.compoundScore}/100
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** 72-hour bulletin timeline view (Req 53.2) */
const BulletinView: React.FC<{ entries: BulletinEntry[] }> = ({ entries }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-sm, 8px)',
    }}
  >
    {entries.map((entry) => {
      const color = ALERT_COLORS[entry.overallAlertLevel];
      return (
        <div
          key={entry.hourOffset}
          style={{
            background: entry.hourOffset === 0 ? `${color}15` : 'rgba(var(--fg-rgb),var(--fg-a05))',
            border: `1px solid ${entry.hourOffset === 0 ? color : 'rgba(var(--fg-rgb),var(--fg-a08))'}`,
            borderRadius: 'var(--radius-sm, 6px)',
            padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
            display: 'grid',
            gridTemplateColumns: '140px 1fr auto',
            alignItems: 'center',
            gap: 'var(--space-sm, 8px)',
          }}
        >
          {/* Time label */}
          <span
            style={{
              fontSize: 'var(--font-small, 12px)',
              color: entry.hourOffset === 0 ? 'rgba(var(--fg-rgb),var(--fg-a75))' : 'rgba(var(--fg-rgb),var(--fg-a6))',
              fontWeight: entry.hourOffset === 0 ? 'var(--font-weight-semibold, 600)' : 'var(--font-weight-regular, 400)',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.label}
          </span>

          {/* Hazard icons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            {entry.hazards.map((h) => (
              <span
                key={h.type}
                title={`${HAZARD_LABELS[h.type]}: ${h.affectedCount} location${h.affectedCount !== 1 ? 's' : ''}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: 'var(--font-small, 12px)',
                  color: 'rgba(var(--fg-rgb),var(--fg-a7))',
                }}
              >
                <span style={{ fontSize: '14px' }}>{HAZARD_ICONS[h.type]}</span>
                <span>{h.affectedCount}</span>
              </span>
            ))}
          </div>

          {/* Alert level badge */}
          <AlertLevelBadge level={entry.overallAlertLevel} />
        </div>
      );
    })}
  </div>
);

export default MultiHazardView;
