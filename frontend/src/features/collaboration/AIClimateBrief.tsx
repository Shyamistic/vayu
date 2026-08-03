/**
 * AIClimateBrief — Daily plain-language climate summary card.
 *
 * Requirements: 64.1, 64.2, 64.3, 64.4
 *
 * Exports pure functions for brief generation from prediction data,
 * enabling unit testing without DOM.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system/GlassPanel';
import type { GridCell, RegionId } from '../../types';

// ── Data types ────────────────────────────────────────────────────────────────

export interface BriefInput {
  /** Prediction grid cells (may cover multiple lead-time days) */
  cells: GridCell[];
  /** Active region */
  region: RegionId;
  /** Forecast base date (ISO string, e.g. "2025-06-15") */
  forecastDate: string;
  /** Pre-detected active hazards from other analysis panels */
  activeHazards?: ActiveHazard[];
}

export interface ActiveHazard {
  type: 'flood' | 'drought' | 'heatwave' | 'cyclone' | 'aqi';
  severity: 'watch' | 'warning' | 'emergency';
  description: string;
}

export interface ClimateBriefSections {
  headline: string;
  keySummary: string;
  rainfallOutlook: string;
  temperatureOutlook: string;
  hazardHighlight: string;
  recommendedActions: string[];
  generatedAt: string;
}

export interface ClimateBrief {
  sections: ClimateBriefSections;
  region: RegionId;
  forecastDate: string;
}

// ── Region display names ──────────────────────────────────────────────────────

const REGION_LABELS: Record<RegionId, string> = {
  western_ghats: 'Western Ghats',
  north_east_india: 'North-East India',
  indo_gangetic_plain: 'Indo-Gangetic Plain',
  central_india: 'Central India',
  pilot: 'Pilot Region',
};

// ── Pure helper utilities ─────────────────────────────────────────────────────

/** Compute mean of a numeric array; returns 0 for empty arrays. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Compute max of a numeric array; returns 0 for empty arrays. */
export function max(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

/** Percentage of cells exceeding a threshold (0–100). */
export function pctAbove(values: number[], threshold: number): number {
  if (values.length === 0) return 0;
  return (values.filter((v) => v > threshold).length / values.length) * 100;
}

/** Format a date string (ISO) as a human-readable date like "15 Jun 2025". */
export function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Rainfall interpretation ───────────────────────────────────────────────────

/** Returns a plain-language rainfall outlook sentence. */
export function buildRainfallOutlook(cells: GridCell[]): string {
  const rainfalls = cells.map((c) => c.rainfall);
  const avgRain = mean(rainfalls);
  const maxRain = max(rainfalls);
  const heavyPct = pctAbove(rainfalls, 64.5); // IMD heavy rain threshold mm/day
  const veryHeavyPct = pctAbove(rainfalls, 115.5); // IMD very-heavy rain mm/day

  if (avgRain < 2.5) {
    return 'Largely dry conditions are expected with minimal rainfall across the region.';
  }
  if (avgRain < 15) {
    return `Light to moderate rainfall is anticipated, averaging ${avgRain.toFixed(1)} mm/day. No widespread heavy rain events are forecast.`;
  }
  if (heavyPct > 30) {
    return `Widespread heavy rainfall is likely, with ${heavyPct.toFixed(0)}% of the region forecast to receive >64 mm/day. Peak accumulation may reach ${maxRain.toFixed(0)} mm in isolated locations.`;
  }
  if (veryHeavyPct > 10) {
    return `Very heavy to extremely heavy rainfall is forecast for ${veryHeavyPct.toFixed(0)}% of grid points, with peak values up to ${maxRain.toFixed(0)} mm/day. Flash-flood risk is elevated.`;
  }
  return `Moderate to heavy rainfall is expected, averaging ${avgRain.toFixed(1)} mm/day across the region.`;
}

// ── Temperature interpretation ────────────────────────────────────────────────

/** Returns a plain-language temperature outlook sentence. */
export function buildTemperatureOutlook(cells: GridCell[]): string {
  const maxTemps = cells.map((c) => c.temp_max);
  const minTemps = cells.map((c) => c.temp_min);
  const avgMax = mean(maxTemps);
  const avgMin = mean(minTemps);
  const extremeHotPct = pctAbove(maxTemps, 40);
  const mildMax = avgMax < 30;

  if (extremeHotPct > 20) {
    return `Extreme heat is forecast, with ${extremeHotPct.toFixed(0)}% of the region exceeding 40°C. Daytime highs average ${avgMax.toFixed(1)}°C; overnight lows offer limited relief at ${avgMin.toFixed(1)}°C.`;
  }
  if (avgMax > 35) {
    return `Hot and humid conditions prevail. Maximum temperatures averaging ${avgMax.toFixed(1)}°C with minimum temperatures around ${avgMin.toFixed(1)}°C overnight.`;
  }
  if (mildMax) {
    return `Mild and comfortable temperatures are expected with daytime highs of ${avgMax.toFixed(1)}°C and overnight lows of ${avgMin.toFixed(1)}°C.`;
  }
  return `Temperatures will be warm to moderately hot, ranging from ${avgMin.toFixed(1)}°C at night to ${avgMax.toFixed(1)}°C in the afternoon.`;
}

// ── Hazard highlight ──────────────────────────────────────────────────────────

/** Returns a hazard summary sentence from detected hazards or derived from cell data. */
export function buildHazardHighlight(
  cells: GridCell[],
  activeHazards: ActiveHazard[],
): string {
  if (activeHazards.length > 0) {
    const emergency = activeHazards.filter((h) => h.severity === 'emergency');
    const warnings = activeHazards.filter((h) => h.severity === 'warning');
    const parts: string[] = [];
    if (emergency.length > 0) {
      parts.push(`🚨 Emergency: ${emergency.map((h) => h.description).join('; ')}`);
    }
    if (warnings.length > 0) {
      parts.push(`⚠️ Warning: ${warnings.map((h) => h.description).join('; ')}`);
    }
    if (parts.length > 0) return parts.join(' | ');
  }

  // Derive from cell data if no pre-computed hazards
  const rainfalls = cells.map((c) => c.rainfall);
  const maxTemps = cells.map((c) => c.temp_max);
  const heavyRainCells = rainfalls.filter((r) => r > 64.5).length;
  const heatWaveCells = maxTemps.filter((t) => t > 40).length;

  if (heavyRainCells > 0 && heatWaveCells > 0) {
    return `Mixed hazard conditions: heavy rainfall in ${heavyRainCells} grid cells alongside extreme heat in ${heatWaveCells} cells. Localised flooding and heat stress are both concerns.`;
  }
  if (heavyRainCells > 0) {
    return `Primary hazard: heavy rainfall affecting ${heavyRainCells} grid cell${heavyRainCells > 1 ? 's' : ''}. Flooding of low-lying areas and drainage overload is possible.`;
  }
  if (heatWaveCells > 0) {
    return `Primary hazard: extreme heat conditions detected in ${heatWaveCells} grid cell${heatWaveCells > 1 ? 's' : ''}. Outdoor activities should be limited during peak afternoon hours.`;
  }
  return 'No significant hazards are currently forecast for the next 72 hours. Conditions are expected to remain within normal seasonal bounds.';
}

// ── Recommended actions ───────────────────────────────────────────────────────

/** Derives recommended actions from the climate data. */
export function buildRecommendedActions(
  cells: GridCell[],
  activeHazards: ActiveHazard[],
): string[] {
  const actions: string[] = [];
  const rainfalls = cells.map((c) => c.rainfall);
  const maxTemps = cells.map((c) => c.temp_max);
  const avgRain = mean(rainfalls);
  const maxRain = max(rainfalls);
  const avgMax = mean(maxTemps);

  const hasFloodHazard = activeHazards.some((h) => h.type === 'flood') || maxRain > 115;
  const hasHeatHazard = activeHazards.some((h) => h.type === 'heatwave') || avgMax > 40;
  const hasDroughtHazard = activeHazards.some((h) => h.type === 'drought') || avgRain < 2.5;

  if (hasFloodHazard) {
    actions.push('Alert flood-prone district administrations to pre-position relief materials.');
    actions.push('Issue advisories to farmers to protect standing crops and delay harvest operations.');
    actions.push('Activate early warning systems for river basins with predicted upstream accumulation >100 mm.');
  }
  if (hasHeatHazard) {
    actions.push('Issue Heat Action Plan alerts to district health departments.');
    actions.push('Open cooling centres in urban areas between 12:00–17:00 local time.');
    actions.push('Advise agricultural workers to avoid outdoor labour during peak heat (11:00–15:00).');
  }
  if (hasDroughtHazard) {
    actions.push('Advise farmers to conserve soil moisture using mulching and deficit irrigation techniques.');
    actions.push('Coordinate with state irrigation departments for strategic reservoir release scheduling.');
  }
  if (actions.length === 0) {
    actions.push('Continue routine monitoring of weather conditions.');
    actions.push('No immediate protective action required based on current forecasts.');
  }
  return actions;
}

// ── Headline builder ──────────────────────────────────────────────────────────

/** Generates a concise one-line headline for the brief. */
export function buildHeadline(
  cells: GridCell[],
  region: RegionId,
  activeHazards: ActiveHazard[],
): string {
  const regionLabel = REGION_LABELS[region] ?? region;
  const rainfalls = cells.map((c) => c.rainfall);
  const maxTemps = cells.map((c) => c.temp_max);
  const maxRain = max(rainfalls);
  const avgMax = mean(maxTemps);
  const emergency = activeHazards.some((h) => h.severity === 'emergency');
  const warning = activeHazards.some((h) => h.severity === 'warning');

  if (emergency) return `🚨 Emergency Alert: Severe conditions forecast for ${regionLabel}`;
  if (maxRain > 115) return `⚠️ Extremely Heavy Rainfall Forecast — ${regionLabel}`;
  if (avgMax > 40) return `🌡️ Extreme Heat Advisory — ${regionLabel}`;
  if (warning) return `⚠️ Active Weather Warning — ${regionLabel}`;
  if (maxRain > 64.5) return `🌧️ Heavy Rainfall Expected — ${regionLabel}`;
  if (avgMax > 35) return `☀️ Hot Conditions Forecast — ${regionLabel}`;
  return `🌤️ Routine Climate Brief — ${regionLabel}`;
}

// ── Main brief generator (pure) ───────────────────────────────────────────────

/**
 * Generates a structured ClimateBrief from prediction data.
 * Pure function — no side effects or DOM dependencies.
 *
 * Validates: Requirements 64.1, 64.2
 */
export function generateClimateBrief(input: BriefInput): ClimateBrief {
  const { cells, region, forecastDate, activeHazards = [] } = input;

  const rainfalls = cells.map((c) => c.rainfall);
  const maxTemps = cells.map((c) => c.temp_max);
  const avgRain = mean(rainfalls);
  const avgMax = mean(maxTemps);
  const maxRain = max(rainfalls);

  const keySummary = [
    `Forecast for ${REGION_LABELS[region] ?? region} valid through ${formatDate(forecastDate)}.`,
    `Average rainfall: ${avgRain.toFixed(1)} mm/day (peak ${maxRain.toFixed(0)} mm).`,
    `Average maximum temperature: ${avgMax.toFixed(1)}°C.`,
    activeHazards.length > 0
      ? `${activeHazards.length} active hazard alert${activeHazards.length > 1 ? 's' : ''} in effect.`
      : 'No active hazard alerts.',
  ].join(' ');

  return {
    region,
    forecastDate,
    sections: {
      headline: buildHeadline(cells, region, activeHazards),
      keySummary,
      rainfallOutlook: buildRainfallOutlook(cells),
      temperatureOutlook: buildTemperatureOutlook(cells),
      hazardHighlight: buildHazardHighlight(cells, activeHazards),
      recommendedActions: buildRecommendedActions(cells, activeHazards),
      generatedAt: new Date().toISOString(),
    },
  };
}

// ── Email HTML export (pure) ──────────────────────────────────────────────────

/**
 * Renders the climate brief as an email-ready HTML block.
 * Validates: Requirement 64.4
 */
export function exportBriefAsEmailHtml(brief: ClimateBrief): string {
  const { sections, region, forecastDate } = brief;
  const regionLabel = REGION_LABELS[region] ?? region;
  const actionsHtml = sections.recommendedActions
    .map((a) => `<li style="margin-bottom:6px;line-height:1.6;">${a}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAUSAM Climate Brief — ${regionLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f,#0d6b8c);padding:24px 32px;color:#ffffff;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;opacity:0.7;margin-bottom:8px;">MAUSAM Climate Digital Twin · ISRO</div>
            <div style="font-size:22px;font-weight:700;line-height:1.3;">${sections.headline}</div>
            <div style="font-size:13px;opacity:0.8;margin-top:8px;">${regionLabel} · Forecast Date: ${formatDate(forecastDate)}</div>
          </td>
        </tr>
        <!-- Key Summary -->
        <tr>
          <td style="padding:24px 32px 0;">
            <div style="background:#f0f7ff;border-left:4px solid #0d6b8c;padding:12px 16px;border-radius:4px;font-size:14px;color:#1a3344;line-height:1.6;">
              ${sections.keySummary}
            </div>
          </td>
        </tr>
        <!-- Sections -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="48%" style="vertical-align:top;padding-right:12px;">
                  <div style="font-size:13px;font-weight:700;color:#0d6b8c;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🌧 Rainfall Outlook</div>
                  <div style="font-size:14px;color:#333;line-height:1.6;">${sections.rainfallOutlook}</div>
                </td>
                <td width="4%"></td>
                <td width="48%" style="vertical-align:top;">
                  <div style="font-size:13px;font-weight:700;color:#c0392b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🌡 Temperature Outlook</div>
                  <div style="font-size:14px;color:#333;line-height:1.6;">${sections.temperatureOutlook}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Hazard -->
        <tr>
          <td style="padding:20px 32px 0;">
            <div style="font-size:13px;font-weight:700;color:#e67e22;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">⚠ Hazard Highlight</div>
            <div style="font-size:14px;color:#333;line-height:1.6;">${sections.hazardHighlight}</div>
          </td>
        </tr>
        <!-- Recommended Actions -->
        <tr>
          <td style="padding:20px 32px 24px;">
            <div style="font-size:13px;font-weight:700;color:#27ae60;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">✅ Recommended Actions</div>
            <ul style="margin:0;padding-left:20px;font-size:14px;color:#333;">${actionsHtml}</ul>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f4f6f8;padding:16px 32px;border-top:1px solid #e0e0e0;">
            <div style="font-size:11px;color:#888;line-height:1.5;">
              Generated by MAUSAM Climate Digital Twin · AI Summary Engine v1.0<br/>
              This brief was generated at ${new Date(sections.generatedAt).toLocaleString('en-IN')} using VAYU model predictions.<br/>
              For operational decisions, cross-reference with IMD official forecasts.
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── localStorage key for dismissal tracking ───────────────────────────────────

const DISMISSED_KEY = 'mausam_brief_dismissed_date';

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function wasDismissedToday(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === getTodayDateString();
  } catch {
    return false;
  }
}

function markDismissedToday(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, getTodayDateString());
  } catch {
    // localStorage unavailable — ignore silently
  }
}

// ── Component props ───────────────────────────────────────────────────────────

export interface AIClimateBriefProps {
  /** Grid cells from the active prediction */
  cells: GridCell[];
  /** Currently selected region */
  region: RegionId;
  /** Forecast base date (ISO string) */
  forecastDate: string;
  /** Optional pre-detected hazards from other panels */
  activeHazards?: ActiveHazard[];
  /** Whether the brief feature is enabled */
  enabled?: boolean;
}

// ── AIClimateBrief component ──────────────────────────────────────────────────

/**
 * AIClimateBrief renders as a dismissible card on first daily load.
 * Validates: Requirements 64.1, 64.2, 64.3, 64.4
 */
export const AIClimateBrief: React.FC<AIClimateBriefProps> = ({
  cells,
  region,
  forecastDate,
  activeHazards = [],
  enabled = true,
}) => {
  const [dismissed, setDismissed] = useState<boolean>(wasDismissedToday);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [exportCopied, setExportCopied] = useState<boolean>(false);

  const brief = useMemo<ClimateBrief | null>(() => {
    if (!enabled || cells.length === 0) return null;
    return generateClimateBrief({ cells, region, forecastDate, activeHazards });
  }, [cells, region, forecastDate, activeHazards, enabled]);

  const handleDismiss = useCallback(() => {
    markDismissedToday();
    setDismissed(true);
  }, []);

  const handleExport = useCallback(() => {
    if (!brief) return;
    const html = exportBriefAsEmailHtml(brief);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(html).then(() => {
        setExportCopied(true);
        setTimeout(() => setExportCopied(false), 2500);
      });
    } else {
      // Fallback: trigger download
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `climate-brief-${forecastDate}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [brief, forecastDate]);

  if (!enabled || !brief || dismissed) return null;

  const { sections } = brief;

  return (
    <div
      className="ai-climate-brief"
      data-testid="ai-climate-brief"
      role="region"
      aria-label="Daily AI Climate Brief"
      style={{ marginBottom: 'var(--space-md, 12px)' }}
    >
      <GlassPanel padding="md" className="ai-climate-brief-card">
        {/* ── Header row ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: expanded ? '16px' : '0',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Eyebrow label */}
            <div
              style={{
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '1.5px',
                color: 'rgba(99, 179, 237, 0.9)',
                marginBottom: '4px',
              }}
            >
              🤖 Daily AI Climate Brief
            </div>
            {/* Headline */}
            <h2
              style={{
                margin: 0,
                fontSize: 'var(--font-body-lg, 15px)',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.95)',
                lineHeight: 1.4,
              }}
            >
              {sections.headline}
            </h2>
            {/* Key summary — always visible */}
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 'var(--font-small, 12px)',
                color: 'rgba(255, 255, 255, 0.65)',
                lineHeight: 1.55,
              }}
            >
              {sections.keySummary}
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
            <button
              onClick={handleExport}
              title="Copy as email-ready HTML"
              aria-label="Export brief as email HTML"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                color: exportCopied ? '#4ade80' : 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 500,
                padding: '4px 8px',
                transition: 'all 200ms',
                whiteSpace: 'nowrap',
              }}
            >
              {exportCopied ? '✓ Copied' : '📧 Export'}
            </button>
            <button
              onClick={() => setDismissed(false) /* no-op to keep existing; real dismiss below */}
              style={{ display: 'none' }}
              aria-hidden="true"
            />
            <button
              onClick={handleDismiss}
              title="Dismiss for today"
              aria-label="Dismiss brief for today"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                fontSize: '16px',
                lineHeight: 1,
                padding: '2px 4px',
                transition: 'color 200ms',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.9)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.45)'; }}
            >
              ×
            </button>
          </div>
        </div>

        {/* ── Read Full Brief toggle ── */}
        <button
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls="ai-brief-full-content"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(99, 179, 237, 0.85)',
            fontSize: '12px',
            fontWeight: 500,
            padding: expanded ? '8px 0 0' : '8px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            transition: 'color 200ms',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(99, 179, 237, 1)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(99, 179, 237, 0.85)'; }}
        >
          <span
            style={{
              display: 'inline-block',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            ▶
          </span>
          {expanded ? 'Collapse Brief' : 'Read Full Brief'}
        </button>
      </GlassPanel>

      {/* ── Expanded full brief ── */}
      {expanded && (
        <div
          id="ai-brief-full-content"
          data-testid="ai-brief-full-content"
          style={{
            marginTop: '8px',
            animation: 'brief-expand-in 250ms cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* Rainfall Outlook */}
          <GlassPanel padding="sm" className="brief-section">
            <BriefSection
              icon="🌧️"
              title="Rainfall Outlook"
              accentColor="#63b3ed"
              content={sections.rainfallOutlook}
            />
          </GlassPanel>

          {/* Temperature Outlook */}
          <GlassPanel padding="sm" className="brief-section">
            <BriefSection
              icon="🌡️"
              title="Temperature Outlook"
              accentColor="#fc8181"
              content={sections.temperatureOutlook}
            />
          </GlassPanel>

          {/* Hazard Highlight */}
          <GlassPanel padding="sm" className="brief-section">
            <BriefSection
              icon="⚠️"
              title="Hazard Highlight"
              accentColor="#f6ad55"
              content={sections.hazardHighlight}
            />
          </GlassPanel>

          {/* Recommended Actions */}
          <GlassPanel padding="sm" className="brief-section">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '8px',
              }}
            >
              <span style={{ fontSize: '14px' }} aria-hidden="true">✅</span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  color: '#68d391',
                }}
              >
                Recommended Actions
              </span>
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: '18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
              }}
            >
              {sections.recommendedActions.map((action, idx) => (
                <li
                  key={idx}
                  style={{
                    fontSize: 'var(--font-small, 12px)',
                    color: 'rgba(255, 255, 255, 0.75)',
                    lineHeight: 1.55,
                  }}
                >
                  {action}
                </li>
              ))}
            </ul>
          </GlassPanel>

          {/* Footer meta */}
          <div
            style={{
              fontSize: '10px',
              color: 'rgba(255,255,255,0.3)',
              textAlign: 'right',
              padding: '2px 4px',
            }}
          >
            Generated {new Date(sections.generatedAt).toLocaleTimeString('en-IN')} · VAYU AI Engine
          </div>
        </div>
      )}

      {/* ── Animations ── */}
      <style>{`
        @keyframes brief-expand-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ai-climate-brief-card {
          transition: box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .ai-climate-brief-card:hover {
          box-shadow: 0 6px 32px rgba(99, 179, 237, 0.15);
        }
        .brief-section {
          transition: background 200ms;
        }
      `}</style>
    </div>
  );
};

export default AIClimateBrief;

// ── Sub-component ─────────────────────────────────────────────────────────────

interface BriefSectionProps {
  icon: string;
  title: string;
  accentColor: string;
  content: string;
}

const BriefSection: React.FC<BriefSectionProps> = ({ icon, title, accentColor, content }) => (
  <div>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '6px',
      }}
    >
      <span style={{ fontSize: '14px' }} aria-hidden="true">{icon}</span>
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '1px',
          color: accentColor,
        }}
      >
        {title}
      </span>
    </div>
    <p
      style={{
        margin: 0,
        fontSize: 'var(--font-small, 12px)',
        color: 'rgba(255, 255, 255, 0.75)',
        lineHeight: 1.6,
      }}
    >
      {content}
    </p>
  </div>
);
