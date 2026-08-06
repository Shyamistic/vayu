/**
 * FloodRiskPanel — Flood Risk Early Warning System.
 *
 * Exports pure functions for threshold classification (testable),
 * plus a React component rendering flood-risk zones with animated
 * blue pulse borders, risk level labels, river basin overlay,
 * and PDF Flood Risk Bulletin export.
 *
 * Validates: Requirements 20.1, 20.2, 20.3, 20.4
 */

import React, { useMemo, useCallback } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, RegionId } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Risk levels derived from cumulative rainfall vs thresholds */
export type FloodRiskLevel = 'none' | 'low' | 'moderate' | 'high' | 'extreme';

/** Region-specific cumulative rainfall thresholds (mm over 3 days) */
export interface RegionThresholds {
  /** Threshold above which a cell is considered flood-risk */
  base: number;
  /** Low risk: base .. low */
  low: number;
  /** Moderate risk: low .. moderate */
  moderate: number;
  /** High risk: moderate .. high */
  high: number;
  /** Extreme: above high */
}

/** Flood risk assessment for a single grid cell */
export interface FloodRiskCell {
  cell: GridCell;
  cumulativeRainfall: number;
  riskLevel: FloodRiskLevel;
  region: RegionId;
}

/** River basin descriptor */
export interface RiverBasin {
  id: string;
  name: string;
  /** Bounding box [minLat, maxLat, minLon, maxLon] */
  bounds: [number, number, number, number];
  criticalThreshold: number; // mm upstream accumulation
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Region-specific 3-day cumulative rainfall thresholds (mm).
 * Western Ghats base = 100mm, Indo-Gangetic = 150mm (Req 20.1).
 * Other regions use sensible defaults.
 */
export const REGION_THRESHOLDS: Record<RegionId, RegionThresholds> = {
  western_ghats: { base: 100, low: 150, moderate: 200, high: 300 },
  indo_gangetic_plain: { base: 150, low: 200, moderate: 250, high: 350 },
  north_east_india: { base: 120, low: 180, moderate: 240, high: 350 },
  central_india: { base: 100, low: 160, moderate: 220, high: 320 },
  full_india: { base: 100, low: 150, moderate: 200, high: 300 },
};

/** Color palette for flood risk levels (blue family per Req 20.2) */
export const RISK_COLORS: Record<FloodRiskLevel, string> = {
  none: 'transparent',
  low: '#93c5fd',       // blue-300
  moderate: '#3b82f6',  // blue-500
  high: '#1d4ed8',      // blue-700
  extreme: '#1e3a8a',   // blue-900
};

/** Representative Indian river basins for overlay (Req 20.4) */
export const RIVER_BASINS: RiverBasin[] = [
  { id: 'ganga', name: 'Ganga', bounds: [24, 31, 78, 88], criticalThreshold: 120 },
  { id: 'brahmaputra', name: 'Brahmaputra', bounds: [25, 29, 89, 97], criticalThreshold: 150 },
  { id: 'godavari', name: 'Godavari', bounds: [16, 22, 73, 82], criticalThreshold: 100 },
  { id: 'krishna', name: 'Krishna', bounds: [14, 19, 73, 80], criticalThreshold: 100 },
  { id: 'mahanadi', name: 'Mahanadi', bounds: [19, 24, 80, 87], criticalThreshold: 110 },
  { id: 'narmada', name: 'Narmada', bounds: [21, 24, 72, 82], criticalThreshold: 90 },
];


// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Classify flood risk level for a given cumulative rainfall and region.
 *
 * A cell is flagged as flood-risk if and only if cumulativeRainfall > base.
 *   - 'none'     if cumulative ≤ base threshold
 *   - 'low'      if base < cumulative ≤ low
 *   - 'moderate' if low < cumulative ≤ moderate
 *   - 'high'     if moderate < cumulative ≤ high
 *   - 'extreme'  if cumulative > high
 *
 * Validates: Requirement 20.1
 */
export function classifyFloodRisk(
  cumulativeRainfall: number,
  region: RegionId,
): FloodRiskLevel {
  const t = REGION_THRESHOLDS[region];
  if (cumulativeRainfall <= t.base) return 'none';
  if (cumulativeRainfall <= t.low) return 'low';
  if (cumulativeRainfall <= t.moderate) return 'moderate';
  if (cumulativeRainfall <= t.high) return 'high';
  return 'extreme';
}

/**
 * Compute 3-day cumulative rainfall for a grid cell from a multi-day
 * prediction array.  Each element of `dailyRainfallArrays` is the
 * ordered grid cells for that forecast day (day 1 … day 3).
 *
 * Returns 0 when the cell is not found in a given day's data.
 */
export function computeCumulativeRainfall(
  nodeIdx: number,
  dailyRainfallArrays: GridCell[][],
): number {
  return dailyRainfallArrays.reduce((sum, dayCells) => {
    const match = dayCells.find((c) => c.node_idx === nodeIdx);
    return sum + (match ? match.rainfall : 0);
  }, 0);
}

/**
 * Assess flood risk across all grid cells.
 *
 * `dailyRainfallArrays` — array of 3 day-arrays (days 1-3).
 * Returns only cells with riskLevel !== 'none'.
 */
export function assessFloodRisk(
  baseCells: GridCell[],
  dailyRainfallArrays: GridCell[][],
  region: RegionId,
): FloodRiskCell[] {
  return baseCells
    .map((cell) => {
      const cumulativeRainfall = computeCumulativeRainfall(
        cell.node_idx,
        dailyRainfallArrays,
      );
      const riskLevel = classifyFloodRisk(cumulativeRainfall, region);
      return { cell, cumulativeRainfall, riskLevel, region };
    })
    .filter((r) => r.riskLevel !== 'none');
}

/**
 * Determine which river basins have exceeded their critical threshold
 * based on mean upstream accumulation within their bounds.
 */
export function flagCriticalBasins(
  riskCells: FloodRiskCell[],
  basins: RiverBasin[],
): RiverBasin[] {
  return basins.filter((basin) => {
    const [minLat, maxLat, minLon, maxLon] = basin.bounds;
    const upstream = riskCells.filter(
      (r) =>
        r.cell.lat >= minLat &&
        r.cell.lat <= maxLat &&
        r.cell.lon >= minLon &&
        r.cell.lon <= maxLon,
    );
    if (upstream.length === 0) return false;
    const meanAccumulation =
      upstream.reduce((s, r) => s + r.cumulativeRainfall, 0) / upstream.length;
    return meanAccumulation > basin.criticalThreshold;
  });
}


// ── PDF Export ───────────────────────────────────────────────────────────────

/** Recommended actions keyed by risk level */
const RECOMMENDED_ACTIONS: Record<Exclude<FloodRiskLevel, 'none'>, string[]> = {
  low: [
    'Monitor local water levels closely.',
    'Prepare emergency kits for households in low-lying areas.',
    'Clear drainage channels of debris.',
  ],
  moderate: [
    'Issue public advisories for flood-prone areas.',
    'Pre-position emergency response teams.',
    'Warn riverside communities to stay alert.',
    'Coordinate with district administration for early evacuation plans.',
  ],
  high: [
    'Initiate precautionary evacuation of low-lying areas.',
    'Open relief camps and shelters.',
    'Deploy NDRF / SDRF teams to vulnerable zones.',
    'Restrict traffic on flood-prone roads and bridges.',
  ],
  extreme: [
    'Immediately evacuate all flood-prone and riverside populations.',
    'Activate state-level disaster management protocols.',
    'Request central assistance (NDRF, Indian Army, Air Force).',
    'Close all low-lying roads and bridges.',
    'Issue Red Alert to all districts within affected basins.',
  ],
};

/**
 * Generate and download a plain-text Flood Risk Bulletin as PDF.
 *
 * Uses the browser's Print API via a hidden iframe for zero-dependency
 * PDF generation, ensuring it works in all modern browsers without
 * requiring a library bundle.
 *
 * Validates: Requirement 20.3
 */
export function exportFloodRiskBulletin(
  riskCells: FloodRiskCell[],
  criticalBasins: RiverBasin[],
  region: RegionId,
  issuedAt: Date = new Date(),
): void {
  const dateStr = issuedAt.toUTCString();
  const highRiskCells = riskCells.filter(
    (r) => r.riskLevel === 'high' || r.riskLevel === 'extreme',
  );

  // Gather all unique recommended actions across risk levels present
  const riskLevelsPresent = [
    ...new Set(
      riskCells
        .map((r) => r.riskLevel)
        .filter((l): l is Exclude<FloodRiskLevel, 'none'> => l !== 'none'),
    ),
  ];
  const allActions = riskLevelsPresent.flatMap((l) => RECOMMENDED_ACTIONS[l]);
  const uniqueActions = [...new Set(allActions)];

  const regionLabel = region.replace(/_/g, ' ').toUpperCase();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Flood Risk Bulletin — VAYU / MAUSAM</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; color: #111; }
  h1 { color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; }
  h2 { color: #1e3a8a; margin-top: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #eff6ff; color: #1d4ed8; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px;
           font-weight: bold; color: #fff; }
  .low { background: #3b82f6; }
  .moderate { background: #2563eb; }
  .high { background: #1d4ed8; }
  .extreme { background: #1e3a8a; }
  .footer { margin-top: 40px; font-size: 11px; color: #666; border-top: 1px solid #ccc;
            padding-top: 8px; }
  ul { margin: 4px 0 8px 0; padding-left: 20px; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>⚠ Flood Risk Bulletin</h1>
<p><strong>Region:</strong> ${regionLabel}</p>
<p><strong>Issued:</strong> ${dateStr}</p>
<p><strong>Basis:</strong> 3-day cumulative rainfall predictions from VAYU AI model</p>

<h2>Summary</h2>
<p>Total flood-risk grid cells detected: <strong>${riskCells.length}</strong></p>
<p>High / Extreme risk cells: <strong>${highRiskCells.length}</strong></p>
<p>Critical river basins affected: <strong>${criticalBasins.length > 0 ? criticalBasins.map((b) => b.name).join(', ') : 'None'}</strong></p>

<h2>Affected Areas — Top 20 by Cumulative Rainfall</h2>
<table>
  <thead><tr><th>Lat</th><th>Lon</th><th>3-Day Rainfall (mm)</th><th>Risk Level</th></tr></thead>
  <tbody>
    ${riskCells
      .sort((a, b) => b.cumulativeRainfall - a.cumulativeRainfall)
      .slice(0, 20)
      .map(
        (r) =>
          `<tr>
            <td>${r.cell.lat.toFixed(2)}°</td>
            <td>${r.cell.lon.toFixed(2)}°</td>
            <td>${r.cumulativeRainfall.toFixed(1)}</td>
            <td><span class="badge ${r.riskLevel}">${r.riskLevel.toUpperCase()}</span></td>
          </tr>`,
      )
      .join('')}
  </tbody>
</table>

<h2>Critical River Basins</h2>
${
  criticalBasins.length > 0
    ? `<table>
        <thead><tr><th>Basin</th><th>Critical Threshold (mm)</th></tr></thead>
        <tbody>
          ${criticalBasins
            .map(
              (b) =>
                `<tr><td>${b.name}</td><td>${b.criticalThreshold}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>`
    : '<p>No critical basins flagged at current thresholds.</p>'
}

<h2>Recommended Actions</h2>
<ul>${uniqueActions.map((a) => `<li>${a}</li>`).join('')}</ul>

<div class="footer">
  <p>Generated by VAYU / MAUSAM Climate Digital Twin &mdash; ISRO BAH 2025</p>
  <p>This bulletin is based on AI model predictions and should be used alongside
     official IMD / NDMA advisories for operational decisions.</p>
</div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;';
  document.body.appendChild(iframe);
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }
  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();

  // Clean up after print dialog closes (small delay)
  setTimeout(() => {
    document.body.removeChild(iframe);
  }, 1000);
}


// ── React Component ──────────────────────────────────────────────────────────

export interface FloodRiskPanelProps {
  /** Current day's grid cells (used as base cell list) */
  gridCells: GridCell[];
  /** Arrays of grid cells for days 1–3 of forecast (for cumulative computation) */
  day1Cells?: GridCell[];
  day2Cells?: GridCell[];
  day3Cells?: GridCell[];
  region: RegionId;
  /** Whether the panel is enabled */
  enabled?: boolean;
}

/** Label text for each risk level */
const RISK_LEVEL_LABELS: Record<FloodRiskLevel, string> = {
  none: 'None',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  extreme: 'Extreme',
};

/**
 * FloodRiskPanel component.
 *
 * Renders:
 * 1. Alert banner listing total affected cells
 * 2. Flood-risk zone cards with animated blue pulse borders (Req 20.2)
 * 3. River basin section highlighting critical basins (Req 20.4)
 * 4. Export button for Flood Risk Bulletin PDF (Req 20.3)
 */
export const FloodRiskPanel: React.FC<FloodRiskPanelProps> = ({
  gridCells,
  day1Cells,
  day2Cells,
  day3Cells,
  region,
  enabled = true,
}) => {
  // Build the daily rainfall array for cumulative computation
  const dailyArrays = useMemo<GridCell[][]>(() => {
    const d1 = day1Cells ?? gridCells;
    const d2 = day2Cells ?? gridCells;
    const d3 = day3Cells ?? gridCells;
    return [d1, d2, d3];
  }, [gridCells, day1Cells, day2Cells, day3Cells]);

  const riskCells = useMemo(() => {
    if (!enabled) return [];
    return assessFloodRisk(gridCells, dailyArrays, region);
  }, [gridCells, dailyArrays, region, enabled]);

  const criticalBasins = useMemo(
    () => flagCriticalBasins(riskCells, RIVER_BASINS),
    [riskCells],
  );

  const highCount = useMemo(
    () =>
      riskCells.filter(
        (r) => r.riskLevel === 'high' || r.riskLevel === 'extreme',
      ).length,
    [riskCells],
  );

  const sortedRiskCells = useMemo(
    () =>
      [...riskCells].sort((a, b) => b.cumulativeRainfall - a.cumulativeRainfall),
    [riskCells],
  );

  const handleExport = useCallback(() => {
    exportFloodRiskBulletin(riskCells, criticalBasins, region);
  }, [riskCells, criticalBasins, region]);

  if (!enabled || riskCells.length === 0) return null;

  return (
    <div className="flood-risk-panel" role="region" aria-label="Flood Risk Early Warning">
      {/* ── Alert Banner ── */}
      <div
        className="flood-risk-banner"
        role="alert"
        aria-live="assertive"
        style={{
          background: 'rgba(29, 78, 216, 0.15)',
          border: '1px solid #3b82f6',
          borderRadius: 'var(--radius-md, 8px)',
          padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
          marginBottom: 'var(--space-md, 12px)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm, 8px)',
          animation: 'flood-pulse-banner 2s ease-in-out infinite',
        }}
      >
        <span style={{ fontSize: '18px' }}>🌊</span>
        <span
          style={{
            fontSize: 'var(--font-body-lg, 16px)',
            color: '#93c5fd',
            fontWeight: 'var(--font-weight-semibold, 600)',
          }}
        >
          {riskCells.length} Flood-Risk Zone{riskCells.length !== 1 ? 's' : ''} Detected
        </span>
        {highCount > 0 && (
          <span
            style={{
              fontSize: 'var(--font-small, 12px)',
              color: '#fca5a5',
              marginLeft: 'var(--space-sm, 8px)',
              background: 'rgba(239,68,68,0.15)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-full, 9999px)',
            }}
          >
            {highCount} High / Extreme
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 'var(--font-small, 12px)',
            color: 'rgba(var(--fg-rgb),var(--fg-a4))',
          }}
        >
          3-day cumulative &gt; threshold
        </span>
      </div>

      {/* ── Main Panel ── */}
      <GlassPanel padding="md" className="flood-risk-content">
        {/* Header row */}
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
            Flood Risk Assessment
          </h3>
          <button
            onClick={handleExport}
            aria-label="Export Flood Risk Bulletin as PDF"
            style={{
              background: 'rgba(59, 130, 246, 0.2)',
              border: '1px solid #3b82f6',
              borderRadius: 'var(--radius-sm, 6px)',
              color: '#93c5fd',
              cursor: 'pointer',
              fontSize: 'var(--font-small, 12px)',
              fontWeight: 'var(--font-weight-medium, 500)',
              padding: '4px 10px',
              transition: 'background 200ms var(--ease-standard)',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                'rgba(59,130,246,0.35)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                'rgba(59,130,246,0.2)')
            }
          >
            📄 Export Bulletin (PDF)
          </button>
        </div>

        {/* Risk level summary chips */}
        <RiskLevelSummary riskCells={riskCells} />

        {/* Flood risk zone cards */}
        <div
          className="flood-risk-list"
          style={{
            maxHeight: '280px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm, 8px)',
            marginTop: 'var(--space-md, 12px)',
          }}
        >
          {sortedRiskCells.map((r, idx) => (
            <FloodRiskCard key={`${r.cell.node_idx}-${idx}`} riskCell={r} />
          ))}
        </div>

        {/* River basin section */}
        {criticalBasins.length > 0 && (
          <BasinOverlay criticalBasins={criticalBasins} allBasins={RIVER_BASINS} />
        )}
      </GlassPanel>

      {/* ── Keyframe animations ── */}
      <style>{`
        @keyframes flood-pulse-banner {
          0%, 100% { box-shadow: 0 0 4px rgba(59, 130, 246, 0.3); }
          50% { box-shadow: 0 0 14px rgba(59, 130, 246, 0.65); }
        }
        @keyframes flood-pulse-low {
          0%, 100% { box-shadow: 0 0 3px rgba(147, 197, 253, 0.25); }
          50% { box-shadow: 0 0 9px rgba(147, 197, 253, 0.55); }
        }
        @keyframes flood-pulse-moderate {
          0%, 100% { box-shadow: 0 0 4px rgba(59, 130, 246, 0.3); }
          50% { box-shadow: 0 0 12px rgba(59, 130, 246, 0.65); }
        }
        @keyframes flood-pulse-high {
          0%, 100% { box-shadow: 0 0 5px rgba(29, 78, 216, 0.4); }
          50% { box-shadow: 0 0 14px rgba(29, 78, 216, 0.8); }
        }
        @keyframes flood-pulse-extreme {
          0%, 100% { box-shadow: 0 0 6px rgba(30, 58, 138, 0.5); }
          50% { box-shadow: 0 0 18px rgba(59, 130, 246, 0.9); }
        }
        .flood-card-low      { animation: flood-pulse-low 2.5s ease-in-out infinite; }
        .flood-card-moderate { animation: flood-pulse-moderate 2s ease-in-out infinite; }
        .flood-card-high     { animation: flood-pulse-high 1.8s ease-in-out infinite; }
        .flood-card-extreme  { animation: flood-pulse-extreme 1.4s ease-in-out infinite; }
      `}</style>
    </div>
  );
};


// ── Sub-components ────────────────────────────────────────────────────────────

interface RiskLevelSummaryProps {
  riskCells: FloodRiskCell[];
}

const RiskLevelSummary: React.FC<RiskLevelSummaryProps> = ({ riskCells }) => {
  const counts = useMemo(() => {
    const c: Partial<Record<FloodRiskLevel, number>> = {};
    for (const r of riskCells) {
      c[r.riskLevel] = (c[r.riskLevel] ?? 0) + 1;
    }
    return c;
  }, [riskCells]);

  const levels: Exclude<FloodRiskLevel, 'none'>[] = ['extreme', 'high', 'moderate', 'low'];

  return (
    <div style={{ display: 'flex', gap: 'var(--space-sm, 8px)', flexWrap: 'wrap' }}>
      {levels.map((level) => {
        const count = counts[level];
        if (!count) return null;
        return (
          <span
            key={level}
            style={{
              background: `${RISK_COLORS[level]}22`,
              border: `1px solid ${RISK_COLORS[level]}`,
              borderRadius: 'var(--radius-full, 9999px)',
              color: RISK_COLORS[level],
              fontSize: 'var(--font-small, 12px)',
              fontWeight: 'var(--font-weight-semibold, 600)',
              padding: '3px 10px',
            }}
          >
            {RISK_LEVEL_LABELS[level]}: {count}
          </span>
        );
      })}
    </div>
  );
};

interface FloodRiskCardProps {
  riskCell: FloodRiskCell;
}

const FloodRiskCard: React.FC<FloodRiskCardProps> = ({ riskCell }) => {
  const { cell, cumulativeRainfall, riskLevel, region } = riskCell;
  const color = RISK_COLORS[riskLevel];
  const threshold = REGION_THRESHOLDS[region].base;
  const excess = cumulativeRainfall - threshold;

  return (
    <div
      className={`flood-card-${riskLevel}`}
      style={{
        background: 'rgba(var(--fg-rgb),var(--fg-a05))',
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-sm, 6px)',
        padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        gap: 'var(--space-sm, 8px)',
      }}
    >
      {/* Risk indicator dot */}
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />

      {/* Location and details */}
      <div>
        <div
          style={{
            fontSize: 'var(--font-body, 14px)',
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            fontWeight: 'var(--font-weight-medium, 500)',
          }}
        >
          ({cell.lat.toFixed(2)}°, {cell.lon.toFixed(2)}°)
        </div>
        <div
          style={{
            fontSize: 'var(--font-small, 12px)',
            color: 'rgba(var(--fg-rgb),var(--fg-a6))',
          }}
        >
          3-day total: {cumulativeRainfall.toFixed(1)} mm
          {excess > 0 ? ` (+${excess.toFixed(1)} above threshold)` : ''}
        </div>
      </div>

      {/* Risk level badge */}
      <span
        style={{
          fontSize: 'var(--font-small, 12px)',
          fontWeight: 'var(--font-weight-semibold, 600)',
          color: riskLevel === 'extreme' ? '#93c5fd' : color,
          background: `${color}20`,
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm, 6px)',
          whiteSpace: 'nowrap',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.05em',
        }}
      >
        {RISK_LEVEL_LABELS[riskLevel]}
      </span>
    </div>
  );
};

interface BasinOverlayProps {
  criticalBasins: RiverBasin[];
  allBasins: RiverBasin[];
}

const BasinOverlay: React.FC<BasinOverlayProps> = ({ criticalBasins, allBasins }) => {
  const criticalIds = new Set(criticalBasins.map((b) => b.id));

  return (
    <div style={{ marginTop: 'var(--space-lg, 16px)' }}>
      <h4
        style={{
          fontSize: 'var(--font-body-lg, 16px)',
          fontWeight: 'var(--font-weight-semibold, 600)',
          color: 'rgba(var(--fg-rgb),var(--fg-a75))',
          margin: '0 0 var(--space-sm, 8px) 0',
        }}
      >
        River Basin Status
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs, 4px)' }}>
        {allBasins.map((basin) => {
          const isCritical = criticalIds.has(basin.id);
          return (
            <div
              key={basin.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm, 8px)',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm, 6px)',
                background: isCritical
                  ? 'rgba(29, 78, 216, 0.15)'
                  : 'rgba(var(--fg-rgb),var(--fg-a05))',
                border: isCritical
                  ? '1px solid #3b82f6'
                  : '1px solid rgba(var(--fg-rgb),var(--fg-a05))',
                animation: isCritical
                  ? 'flood-pulse-high 2s ease-in-out infinite'
                  : 'none',
              }}
            >
              <span style={{ fontSize: '14px' }}>{isCritical ? '🔵' : '○'}</span>
              <span
                style={{
                  fontSize: 'var(--font-body, 14px)',
                  color: isCritical ? '#93c5fd' : 'rgba(var(--fg-rgb),var(--fg-a4))',
                  fontWeight: isCritical
                    ? 'var(--font-weight-semibold, 600)'
                    : 'var(--font-weight-regular, 400)',
                  flex: 1,
                }}
              >
                {basin.name}
              </span>
              {isCritical && (
                <span
                  style={{
                    fontSize: 'var(--font-small, 12px)',
                    color: '#fca5a5',
                    background: 'rgba(239,68,68,0.15)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-full, 9999px)',
                    fontWeight: 'var(--font-weight-semibold, 600)',
                  }}
                >
                  ⚠ Critical
                </span>
              )}
              {!isCritical && (
                <span
                  style={{
                    fontSize: 'var(--font-small, 12px)',
                    color: 'rgba(var(--fg-rgb),var(--fg-a3))',
                  }}
                >
                  Normal
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FloodRiskPanel;
