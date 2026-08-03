/**
 * ReportGenerator — Climate Bulletin Report Generation Engine.
 *
 * Compiles the current dashboard view into a structured climate bulletin
 * with executive summary, globe screenshot, 7-day forecast table,
 * anomaly analysis, and risk assessment sections.
 *
 * Exports PDF with ISRO/MAUSAM branding within 10 seconds.
 * Supports three templates: Daily Briefing, Extreme Event Alert, Seasonal Outlook.
 *
 * Pure functions are exported for testability.
 *
 * Validates: Requirements 44.1, 44.2, 44.3, 44.4
 */

import React, { useState, useCallback, useMemo } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, RegionId, VariableId } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Report template types (Req 44.4) */
export type ReportTemplate = 'daily_briefing' | 'extreme_event_alert' | 'seasonal_outlook';

/** Forecast row for the 7-day table */
export interface ForecastRow {
  day: number;
  date: string;
  avgRainfall: number;
  maxRainfall: number;
  avgTempMax: number;
  avgTempMin: number;
  rainfallUncertainty: number;
  tempMaxUncertainty: number;
}

/** Anomaly summary entry */
export interface AnomalySummaryEntry {
  lat: number;
  lon: number;
  variable: VariableId;
  value: number;
  departure: number;
  severity: 'warning' | 'severe' | 'extreme';
}

/** Risk assessment summary */
export interface RiskAssessment {
  floodRiskCount: number;
  highFloodRiskCount: number;
  heatWaveCount: number;
  anomalyCount: number;
  overallRiskLevel: 'low' | 'moderate' | 'high' | 'extreme';
  criticalRegions: string[];
}

/** Full report data structure */
export interface ReportData {
  template: ReportTemplate;
  region: RegionId;
  variable: VariableId;
  generatedAt: Date;
  forecastRows: ForecastRow[];
  anomalies: AnomalySummaryEntry[];
  riskAssessment: RiskAssessment;
  globeScreenshotDataUrl?: string;
}

/** Input for report compilation */
export interface ReportInput {
  template: ReportTemplate;
  region: RegionId;
  variable: VariableId;
  /** Grid cells per forecast day (index 0 = day 1, index 6 = day 7) */
  forecastDaysCells: GridCell[][];
  /** Anomaly results already detected (optional) */
  anomalySummary?: AnomalySummaryEntry[];
  /** Globe canvas element for screenshot (optional) */
  globeCanvas?: HTMLCanvasElement | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const TEMPLATE_LABELS: Record<ReportTemplate, string> = {
  daily_briefing: 'Daily Briefing',
  extreme_event_alert: 'Extreme Event Alert',
  seasonal_outlook: 'Seasonal Outlook',
};

export const TEMPLATE_DESCRIPTIONS: Record<ReportTemplate, string> = {
  daily_briefing: '24–72 hour operational weather summary for daily operational use.',
  extreme_event_alert: 'Urgent bulletin highlighting extreme weather events requiring immediate action.',
  seasonal_outlook: 'Long-range seasonal assessment for agricultural and policy planning.',
};

const REGION_LABELS: Record<RegionId, string> = {
  western_ghats: 'Western Ghats',
  north_east_india: 'North-East India',
  indo_gangetic_plain: 'Indo-Gangetic Plain',
  central_india: 'Central India',
  pilot: 'Pilot Region',
};

const VARIABLE_LABELS: Record<VariableId, string> = {
  rainfall: 'Rainfall (mm)',
  temp_max: 'Maximum Temperature (°C)',
  temp_min: 'Minimum Temperature (°C)',
};

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Compute aggregate statistics for a single forecast day's grid cells.
 * Returns mean rainfall, max rainfall, mean temp_max, mean temp_min,
 * and mean uncertainty values.
 */
export function computeDayStats(cells: GridCell[]): Omit<ForecastRow, 'day' | 'date'> {
  if (cells.length === 0) {
    return {
      avgRainfall: 0,
      maxRainfall: 0,
      avgTempMax: 0,
      avgTempMin: 0,
      rainfallUncertainty: 0,
      tempMaxUncertainty: 0,
    };
  }
  const n = cells.length;
  let sumRainfall = 0;
  let maxRainfall = -Infinity;
  let sumTempMax = 0;
  let sumTempMin = 0;
  let sumRainfallUnc = 0;
  let sumTempMaxUnc = 0;

  for (const c of cells) {
    sumRainfall += c.rainfall;
    if (c.rainfall > maxRainfall) maxRainfall = c.rainfall;
    sumTempMax += c.temp_max;
    sumTempMin += c.temp_min;
    sumRainfallUnc += c.rainfall_uncertainty;
    sumTempMaxUnc += c.temp_max_uncertainty;
  }

  return {
    avgRainfall: sumRainfall / n,
    maxRainfall,
    avgTempMax: sumTempMax / n,
    avgTempMin: sumTempMin / n,
    rainfallUncertainty: sumRainfallUnc / n,
    tempMaxUncertainty: sumTempMaxUnc / n,
  };
}

/**
 * Build a ForecastRow for a given day index (0-based) and its cells.
 * `baseDate` is the reference date (day 1 = baseDate + 1 day).
 */
export function buildForecastRow(
  dayIndex: number,
  cells: GridCell[],
  baseDate: Date,
): ForecastRow {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + dayIndex + 1);
  const dateStr = date.toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return {
    day: dayIndex + 1,
    date: dateStr,
    ...computeDayStats(cells),
  };
}

/**
 * Build the complete 7-day forecast table from an array of per-day cell arrays.
 * Missing days produce zero-filled rows.
 */
export function buildForecastTable(
  forecastDaysCells: GridCell[][],
  baseDate: Date = new Date(),
): ForecastRow[] {
  return Array.from({ length: 7 }, (_, i) => {
    const cells = forecastDaysCells[i] ?? [];
    return buildForecastRow(i, cells, baseDate);
  });
}

/**
 * Compute overall risk assessment from forecast data and anomalies.
 *
 * Overall risk level:
 *   - 'extreme' if any extreme anomaly or >10 high flood-risk cells
 *   - 'high'    if severe anomalies or >5 high flood-risk cells
 *   - 'moderate' if warning anomalies or any flood risk
 *   - 'low'     otherwise
 */
export function computeRiskAssessment(
  forecastRows: ForecastRow[],
  anomalies: AnomalySummaryEntry[],
): RiskAssessment {
  const extremeCount = anomalies.filter((a) => a.severity === 'extreme').length;
  const severeCount = anomalies.filter((a) => a.severity === 'severe').length;
  const warningCount = anomalies.filter((a) => a.severity === 'warning').length;

  // Flood risk: days where avg rainfall exceeds 100mm
  const floodDays = forecastRows.filter((r) => r.avgRainfall > 50);
  const highFloodDays = forecastRows.filter((r) => r.maxRainfall > 100);

  // Heat wave: days where avg temp_max > 40°C
  const heatWaveCount = forecastRows.filter((r) => r.avgTempMax > 40).length;

  let overallRiskLevel: RiskAssessment['overallRiskLevel'] = 'low';
  if (extremeCount > 0 || highFloodDays.length > 3) {
    overallRiskLevel = 'extreme';
  } else if (severeCount > 0 || highFloodDays.length > 1 || heatWaveCount > 2) {
    overallRiskLevel = 'high';
  } else if (warningCount > 0 || floodDays.length > 0 || heatWaveCount > 0) {
    overallRiskLevel = 'moderate';
  }

  const criticalRegions: string[] = [];
  if (highFloodDays.length > 0) criticalRegions.push('Flood-prone areas');
  if (heatWaveCount > 0) criticalRegions.push('Heat-wave affected plains');
  if (extremeCount > 0) criticalRegions.push('Extreme anomaly zones');

  return {
    floodRiskCount: floodDays.length,
    highFloodRiskCount: highFloodDays.length,
    heatWaveCount,
    anomalyCount: anomalies.length,
    overallRiskLevel,
    criticalRegions,
  };
}

/**
 * Compile a complete ReportData object from the provided inputs.
 * Validates: Requirement 44.1
 */
export function compileReport(input: ReportInput, baseDate: Date = new Date()): ReportData {
  const forecastRows = buildForecastTable(input.forecastDaysCells, baseDate);
  const anomalies = input.anomalySummary ?? [];
  const riskAssessment = computeRiskAssessment(forecastRows, anomalies);

  let globeScreenshotDataUrl: string | undefined;
  if (input.globeCanvas) {
    try {
      globeScreenshotDataUrl = input.globeCanvas.toDataURL('image/png');
    } catch {
      // Canvas may be tainted — skip screenshot
    }
  }

  return {
    template: input.template,
    region: input.region,
    variable: input.variable,
    generatedAt: new Date(),
    forecastRows,
    anomalies,
    riskAssessment,
    globeScreenshotDataUrl,
  };
}

// ── PDF HTML Template Builder ─────────────────────────────────────────────────

/** Branding header HTML for ISRO/MAUSAM */
function buildBrandingHeader(): string {
  return `
    <div class="header">
      <div class="brand-row">
        <div class="logo-block">
          <div class="logo-isro">🛰 ISRO</div>
          <div class="logo-mausam">MAUSAM / VAYU</div>
        </div>
        <div class="report-title-block">
          <div class="report-title">Climate Bulletin</div>
          <div class="report-subtitle">VAYU AI Climate Digital Twin — ISRO BAH 2025</div>
        </div>
      </div>
    </div>`;
}

/** Build the executive summary section HTML */
function buildExecutiveSummary(report: ReportData): string {
  const regionLabel = REGION_LABELS[report.region];
  const templateLabel = TEMPLATE_LABELS[report.template];
  const varLabel = VARIABLE_LABELS[report.variable];
  const risk = report.riskAssessment;
  const riskColors: Record<string, string> = {
    low: '#22c55e', moderate: '#f59e0b', high: '#f97316', extreme: '#ef4444',
  };
  const riskColor = riskColors[risk.overallRiskLevel] ?? '#94a3b8';

  const peakRainfallDay = [...report.forecastRows].sort((a, b) => b.maxRainfall - a.maxRainfall)[0];
  const peakTempDay = [...report.forecastRows].sort((a, b) => b.avgTempMax - a.avgTempMax)[0];

  return `
    <section class="section">
      <h2>Executive Summary</h2>
      <table class="meta-table">
        <tr><th>Report Type</th><td>${templateLabel}</td>
            <th>Region</th><td>${regionLabel}</td></tr>
        <tr><th>Primary Variable</th><td>${varLabel}</td>
            <th>Issued</th><td>${report.generatedAt.toUTCString()}</td></tr>
        <tr><th>Overall Risk Level</th>
            <td colspan="3"><span style="color:${riskColor};font-weight:700;font-size:15px;">
              ${risk.overallRiskLevel.toUpperCase()}
            </span></td></tr>
      </table>
      <div class="summary-box">
        <p>The VAYU model 7-day forecast for <strong>${regionLabel}</strong> indicates
        <strong>${risk.anomalyCount}</strong> anomalous grid cell(s),
        <strong>${risk.floodRiskCount}</strong> high-rainfall day(s) (avg &gt;50 mm),
        and <strong>${risk.heatWaveCount}</strong> heat-wave day(s) (avg temp_max &gt;40°C).</p>
        ${peakRainfallDay ? `<p>Peak rainfall expected on <strong>${peakRainfallDay.date} (Day ${peakRainfallDay.day})</strong>
          with max ${peakRainfallDay.maxRainfall.toFixed(1)} mm.</p>` : ''}
        ${peakTempDay && peakTempDay.avgTempMax > 35 ? `<p>Highest temperatures forecast on <strong>${peakTempDay.date} (Day ${peakTempDay.day})</strong>
          with average max ${peakTempDay.avgTempMax.toFixed(1)}°C.</p>` : ''}
        ${risk.criticalRegions.length > 0 ? `<p><strong>Areas requiring attention:</strong> ${risk.criticalRegions.join(', ')}.</p>` : ''}
      </div>
    </section>`;
}

/** Build the globe screenshot section HTML */
function buildScreenshotSection(dataUrl?: string): string {
  if (!dataUrl) {
    return `
      <section class="section">
        <h2>Current Globe View</h2>
        <div class="screenshot-placeholder">
          <p>[Globe screenshot not available — captured live from dashboard]</p>
        </div>
      </section>`;
  }
  return `
    <section class="section">
      <h2>Current Globe View</h2>
      <div class="screenshot-container">
        <img src="${dataUrl}" alt="Globe view screenshot" style="max-width:100%;border-radius:8px;border:1px solid #334155;" />
      </div>
    </section>`;
}

/** Build the 7-day forecast table HTML */
function buildForecastTableHTML(rows: ForecastRow[]): string {
  const rowsHTML = rows.map((r) => {
    const isHighRainfall = r.maxRainfall > 100;
    const isHeatWave = r.avgTempMax > 40;
    const rowClass = isHighRainfall ? 'row-flood' : isHeatWave ? 'row-heat' : '';
    return `
      <tr class="${rowClass}">
        <td><strong>Day ${r.day}</strong></td>
        <td>${r.date}</td>
        <td>${r.avgRainfall.toFixed(1)} <span class="unc">± ${r.rainfallUncertainty.toFixed(1)}</span></td>
        <td>${r.maxRainfall.toFixed(1)}</td>
        <td>${r.avgTempMax.toFixed(1)} <span class="unc">± ${r.tempMaxUncertainty.toFixed(1)}</span></td>
        <td>${r.avgTempMin.toFixed(1)}</td>
        <td>${isHighRainfall ? '<span class="badge badge-flood">⚠ High Rainfall</span>' : isHeatWave ? '<span class="badge badge-heat">🌡 Heat Wave</span>' : '<span class="badge badge-ok">Normal</span>'}</td>
      </tr>`;
  }).join('');

  return `
    <section class="section">
      <h2>7-Day Forecast Table</h2>
      <table>
        <thead>
          <tr>
            <th>Day</th><th>Date</th>
            <th>Avg Rainfall (mm)</th><th>Max Rainfall (mm)</th>
            <th>Avg Temp Max (°C)</th><th>Avg Temp Min (°C)</th>
            <th>Alert</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </section>`;
}

/** Build the anomaly analysis section HTML */
function buildAnomalySection(anomalies: AnomalySummaryEntry[]): string {
  if (anomalies.length === 0) {
    return `
      <section class="section">
        <h2>Anomaly Analysis</h2>
        <p class="muted">No significant anomalies detected in current forecast period.</p>
      </section>`;
  }

  const severityOrder = { extreme: 0, severe: 1, warning: 2 };
  const sorted = [...anomalies].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );
  const severityColors: Record<string, string> = {
    warning: '#f59e0b', severe: '#f97316', extreme: '#ef4444',
  };

  const rowsHTML = sorted.slice(0, 20).map((a) => {
    const color = severityColors[a.severity] ?? '#94a3b8';
    return `
      <tr>
        <td>(${a.lat.toFixed(2)}°, ${a.lon.toFixed(2)}°)</td>
        <td>${VARIABLE_LABELS[a.variable]}</td>
        <td>${a.value.toFixed(1)}</td>
        <td>+${a.departure.toFixed(1)}</td>
        <td><span style="color:${color};font-weight:700;">${a.severity.toUpperCase()}</span></td>
      </tr>`;
  }).join('');

  return `
    <section class="section">
      <h2>Anomaly Analysis</h2>
      <p>Showing top ${Math.min(anomalies.length, 20)} of ${anomalies.length} detected anomal${anomalies.length === 1 ? 'y' : 'ies'}, sorted by severity.</p>
      <table>
        <thead>
          <tr><th>Location</th><th>Variable</th><th>Value</th><th>Departure</th><th>Severity</th></tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </section>`;
}

/** Build the risk assessment section HTML */
function buildRiskSection(risk: RiskAssessment): string {
  const riskColors: Record<string, string> = {
    low: '#22c55e', moderate: '#f59e0b', high: '#f97316', extreme: '#ef4444',
  };
  const riskColor = riskColors[risk.overallRiskLevel] ?? '#94a3b8';

  const recommendations: Record<string, string[]> = {
    low: ['Continue standard monitoring. No immediate action required.'],
    moderate: [
      'Activate precautionary measures in flood-prone districts.',
      'Issue public advisories for extreme heat conditions.',
      'Monitor reservoir and river levels daily.',
    ],
    high: [
      'Pre-position disaster response teams in affected zones.',
      'Issue formal weather warnings to district administrations.',
      'Coordinate with NDRF for standby deployment.',
      'Advise farmers to expedite harvesting operations.',
    ],
    extreme: [
      'Activate state-level disaster management protocols immediately.',
      'Issue Red Alert to all affected districts.',
      'Initiate precautionary evacuation of at-risk populations.',
      'Request central government assistance (NDRF, Indian Army).',
      'Restrict movement in flood-prone areas and close vulnerable bridges.',
    ],
  };

  const recs = recommendations[risk.overallRiskLevel] ?? [];

  return `
    <section class="section">
      <h2>Risk Assessment</h2>
      <div class="risk-grid">
        <div class="risk-card">
          <div class="risk-label">Overall Risk</div>
          <div class="risk-value" style="color:${riskColor}">${risk.overallRiskLevel.toUpperCase()}</div>
        </div>
        <div class="risk-card">
          <div class="risk-label">Flood Risk Days</div>
          <div class="risk-value">${risk.floodRiskCount}</div>
        </div>
        <div class="risk-card">
          <div class="risk-label">Heat Wave Days</div>
          <div class="risk-value">${risk.heatWaveCount}</div>
        </div>
        <div class="risk-card">
          <div class="risk-label">Anomalies Detected</div>
          <div class="risk-value">${risk.anomalyCount}</div>
        </div>
      </div>
      ${risk.criticalRegions.length > 0 ? `
        <p><strong>Critical areas:</strong> ${risk.criticalRegions.join(', ')}.</p>` : ''}
      <h3>Recommended Actions</h3>
      <ul>${recs.map((r) => `<li>${r}</li>`).join('')}</ul>
    </section>`;
}

/** Build the full PDF HTML document */
function buildPDFDocument(report: ReportData): string {
  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #1e293b;
           max-width: 960px; margin: 30px auto; padding: 0 20px; font-size: 13px; }
    .header { border-bottom: 3px solid #1d4ed8; padding-bottom: 12px; margin-bottom: 20px; }
    .brand-row { display: flex; align-items: center; gap: 16px; }
    .logo-isro { font-size: 24px; font-weight: 800; color: #1d4ed8; letter-spacing: 2px; }
    .logo-mausam { font-size: 13px; color: #64748b; font-weight: 600; margin-top: 2px; }
    .report-title { font-size: 22px; font-weight: 700; color: #0f172a; }
    .report-title-block { margin-left: auto; text-align: right; }
    .report-subtitle { font-size: 11px; color: #94a3b8; margin-top: 3px; }
    .section { margin-bottom: 28px; }
    .section h2 { font-size: 16px; font-weight: 700; color: #1d4ed8;
                  border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
    .section h3 { font-size: 14px; font-weight: 600; color: #334155; margin: 12px 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
    th { background: #eff6ff; color: #1e40af; font-weight: 600; }
    tr:nth-child(even) { background: #f8fafc; }
    .row-flood td { background: #eff6ff !important; }
    .row-heat td { background: #fff7ed !important; }
    .meta-table th { width: 130px; }
    .summary-box { background: #f8fafc; border-left: 4px solid #1d4ed8;
                   padding: 12px 16px; border-radius: 0 6px 6px 0; margin-top: 10px; }
    .summary-box p { margin-bottom: 6px; line-height: 1.6; }
    .summary-box p:last-child { margin-bottom: 0; }
    .screenshot-placeholder { background: #f1f5f9; border: 1px dashed #94a3b8;
                               border-radius: 8px; padding: 24px; text-align: center;
                               color: #64748b; }
    .screenshot-container { text-align: center; }
    .risk-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
                 margin-bottom: 12px; }
    .risk-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
                 padding: 10px; text-align: center; }
    .risk-label { font-size: 11px; color: #64748b; font-weight: 600;
                  text-transform: uppercase; letter-spacing: 0.05em; }
    .risk-value { font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 4px;
             font-size: 11px; font-weight: 600; }
    .badge-ok { background: #dcfce7; color: #166534; }
    .badge-flood { background: #dbeafe; color: #1e40af; }
    .badge-heat { background: #ffedd5; color: #9a3412; }
    .unc { color: #94a3b8; font-size: 10px; }
    .muted { color: #94a3b8; font-style: italic; }
    ul { padding-left: 20px; }
    li { margin-bottom: 4px; line-height: 1.5; }
    .footer { margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 10px;
              font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
    @media print {
      body { margin: 10px; }
      .section { page-break-inside: avoid; }
    }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Climate Bulletin — ${TEMPLATE_LABELS[report.template]} — VAYU MAUSAM</title>
<style>${css}</style>
</head>
<body>
${buildBrandingHeader()}
${buildExecutiveSummary(report)}
${buildScreenshotSection(report.globeScreenshotDataUrl)}
${buildForecastTableHTML(report.forecastRows)}
${buildAnomalySection(report.anomalies)}
${buildRiskSection(report.riskAssessment)}
<div class="footer">
  <span>VAYU / MAUSAM Climate Digital Twin — ISRO BAH 2025 — Confidential Draft</span>
  <span>Generated: ${report.generatedAt.toUTCString()}</span>
</div>
</body>
</html>`;
}

/**
 * Export the compiled report as a PDF via the browser's Print API.
 * Uses a hidden iframe to trigger print dialog, completing within 10s.
 *
 * Validates: Requirement 44.3
 */
export function exportReportAsPDF(report: ReportData): Promise<void> {
  return new Promise((resolve, reject) => {
    const html = buildPDFDocument(report);
    const iframe = document.createElement('iframe');
    iframe.style.cssText =
      'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;';
    document.body.appendChild(iframe);

    const timeout = setTimeout(() => {
      document.body.removeChild(iframe);
      reject(new Error('PDF export timed out after 10 seconds'));
    }, 10_000);

    const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!iframeDoc) {
      clearTimeout(timeout);
      document.body.removeChild(iframe);
      reject(new Error('Could not access iframe document'));
      return;
    }

    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    iframe.contentWindow?.focus();
    // Small delay to let browser render the document before printing
    setTimeout(() => {
      iframe.contentWindow?.print();
      clearTimeout(timeout);
      setTimeout(() => {
        document.body.removeChild(iframe);
        resolve();
      }, 500);
    }, 300);
  });
}

// ── React Component ──────────────────────────────────────────────────────────

export interface ReportGeneratorProps {
  region: RegionId;
  variable: VariableId;
  /** Per-day grid cells (index 0 = Day 1, index 6 = Day 7) */
  forecastDaysCells: GridCell[][];
  /** Pre-computed anomaly summaries for inclusion in the report */
  anomalySummary?: AnomalySummaryEntry[];
  /** Globe canvas element for live screenshot capture */
  globeCanvas?: HTMLCanvasElement | null;
}

/**
 * ReportGenerator panel component.
 *
 * Renders:
 * 1. Template selector (Daily Briefing, Extreme Event Alert, Seasonal Outlook)
 * 2. Report preview summary card
 * 3. "Generate & Export PDF" button with loading state
 * 4. Status/error feedback
 *
 * Validates: Requirements 44.1, 44.2, 44.3, 44.4
 */
export const ReportGenerator: React.FC<ReportGeneratorProps> = ({
  region,
  variable,
  forecastDaysCells,
  anomalySummary = [],
  globeCanvas,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplate>('daily_briefing');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error'>('success');

  // Pre-compute a report preview (no screenshot yet)
  const previewReport = useMemo(() => {
    return compileReport({
      template: selectedTemplate,
      region,
      variable,
      forecastDaysCells,
      anomalySummary,
      globeCanvas: null,
    });
  }, [selectedTemplate, region, variable, forecastDaysCells, anomalySummary]);

  const { riskAssessment, forecastRows } = previewReport;

  const handleGeneratePDF = useCallback(async () => {
    setIsGenerating(true);
    setStatusMessage(null);
    const startTime = Date.now();
    try {
      const report = compileReport({
        template: selectedTemplate,
        region,
        variable,
        forecastDaysCells,
        anomalySummary,
        globeCanvas: globeCanvas ?? null,
      });
      await exportReportAsPDF(report);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setStatusType('success');
      setStatusMessage(`PDF export triggered in ${elapsed}s. Check your browser's print dialog.`);
    } catch (err) {
      setStatusType('error');
      setStatusMessage(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedTemplate, region, variable, forecastDaysCells, anomalySummary, globeCanvas]);

  const riskColors: Record<string, string> = {
    low: '#22c55e', moderate: '#f59e0b', high: '#f97316', extreme: '#ef4444',
  };
  const riskColor = riskColors[riskAssessment.overallRiskLevel] ?? '#94a3b8';

  // Peak rainfall day
  const peakDay = [...forecastRows].sort((a, b) => b.maxRainfall - a.maxRainfall)[0];

  return (
    <div className="report-generator" role="region" aria-label="Report Generation Engine">
      <GlassPanel padding="lg" className="report-generator-panel">
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <span style={{ fontSize: '20px' }}>📋</span>
          <h3 style={{
            fontSize: 'var(--font-heading-sm, 18px)',
            fontWeight: 'var(--font-weight-semibold, 600)',
            color: 'rgba(255,255,255,0.95)',
            margin: 0,
          }}>
            Climate Bulletin Generator
          </h3>
        </div>

        {/* ── Template Selector ── */}
        <fieldset style={{ border: 'none', padding: 0, marginBottom: '16px' }}>
          <legend style={{
            fontSize: 'var(--font-small, 12px)',
            fontWeight: 'var(--font-weight-semibold, 600)',
            color: 'rgba(255,255,255,0.6)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: '8px',
          }}>
            Report Template
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(Object.keys(TEMPLATE_LABELS) as ReportTemplate[]).map((tmpl) => (
              <label
                key={tmpl}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  background: selectedTemplate === tmpl
                    ? 'rgba(59, 130, 246, 0.12)'
                    : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${selectedTemplate === tmpl ? '#3b82f6' : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: 'var(--radius-sm, 6px)',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  transition: 'background 200ms, border-color 200ms',
                }}
              >
                <input
                  type="radio"
                  name="report-template"
                  value={tmpl}
                  checked={selectedTemplate === tmpl}
                  onChange={() => setSelectedTemplate(tmpl)}
                  style={{ marginTop: '2px', accentColor: '#3b82f6' }}
                  aria-label={TEMPLATE_LABELS[tmpl]}
                />
                <div>
                  <div style={{
                    fontSize: 'var(--font-body, 14px)',
                    fontWeight: 'var(--font-weight-medium, 500)',
                    color: 'rgba(255,255,255,0.9)',
                  }}>
                    {TEMPLATE_LABELS[tmpl]}
                  </div>
                  <div style={{
                    fontSize: 'var(--font-small, 12px)',
                    color: 'rgba(255,255,255,0.5)',
                    marginTop: '2px',
                  }}>
                    {TEMPLATE_DESCRIPTIONS[tmpl]}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {/* ── Preview Summary ── */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 'var(--radius-sm, 6px)',
          padding: '12px',
          marginBottom: '14px',
        }}>
          <div style={{
            fontSize: 'var(--font-small, 12px)',
            fontWeight: 'var(--font-weight-semibold, 600)',
            color: 'rgba(255,255,255,0.55)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: '8px',
          }}>
            Report Preview
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <PreviewStat label="Region" value={REGION_LABELS[region]} />
            <PreviewStat label="Variable" value={variable.replace('_', ' ').toUpperCase()} />
            <PreviewStat label="Overall Risk" value={riskAssessment.overallRiskLevel.toUpperCase()} valueColor={riskColor} />
            <PreviewStat label="Anomalies" value={`${riskAssessment.anomalyCount}`} />
            <PreviewStat label="Flood Risk Days" value={`${riskAssessment.floodRiskCount} / 7`} />
            <PreviewStat
              label="Peak Rainfall"
              value={peakDay ? `${peakDay.maxRainfall.toFixed(1)} mm (Day ${peakDay.day})` : '—'}
            />
          </div>
        </div>

        {/* ── Generate Button ── */}
        <button
          onClick={handleGeneratePDF}
          disabled={isGenerating}
          aria-label="Generate and export climate bulletin as PDF"
          style={{
            width: '100%',
            background: isGenerating
              ? 'rgba(59, 130, 246, 0.15)'
              : 'rgba(59, 130, 246, 0.25)',
            border: '1px solid #3b82f6',
            borderRadius: 'var(--radius-sm, 6px)',
            color: isGenerating ? 'rgba(147, 197, 253, 0.6)' : '#93c5fd',
            cursor: isGenerating ? 'not-allowed' : 'pointer',
            fontSize: 'var(--font-body, 14px)',
            fontWeight: 'var(--font-weight-semibold, 600)',
            padding: '10px 16px',
            transition: 'background 200ms, color 200ms',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
          onMouseEnter={(e) => {
            if (!isGenerating) {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.38)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isGenerating) {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.25)';
            }
          }}
        >
          {isGenerating ? (
            <>
              <span style={{ animation: 'report-spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
              Generating PDF…
            </>
          ) : (
            <>📄 Generate &amp; Export PDF</>
          )}
        </button>

        {/* ── Status Feedback ── */}
        {statusMessage && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm, 6px)',
              background: statusType === 'success'
                ? 'rgba(34, 197, 94, 0.1)'
                : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${statusType === 'success' ? '#22c55e' : '#ef4444'}`,
              fontSize: 'var(--font-small, 12px)',
              color: statusType === 'success' ? '#86efac' : '#fca5a5',
            }}
          >
            {statusType === 'success' ? '✓ ' : '✕ '}
            {statusMessage}
          </div>
        )}

        {/* ── Report Contents Info ── */}
        <div style={{ marginTop: '14px' }}>
          <div style={{
            fontSize: 'var(--font-small, 12px)',
            color: 'rgba(255,255,255,0.4)',
            marginBottom: '4px',
          }}>
            Report includes:
          </div>
          <ul style={{
            fontSize: 'var(--font-small, 12px)',
            color: 'rgba(255,255,255,0.5)',
            paddingLeft: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}>
            <li>Executive summary with key metrics</li>
            <li>Globe screenshot (if available)</li>
            <li>7-day forecast table with uncertainties</li>
            <li>Anomaly analysis ({riskAssessment.anomalyCount} detected)</li>
            <li>Risk assessment &amp; recommended actions</li>
            <li>ISRO / MAUSAM branding</li>
          </ul>
        </div>
      </GlassPanel>

      {/* Keyframe for spinner */}
      <style>{`
        @keyframes report-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

// ── PreviewStat sub-component ─────────────────────────────────────────────────

interface PreviewStatProps {
  label: string;
  value: string;
  valueColor?: string;
}

const PreviewStat: React.FC<PreviewStatProps> = ({ label, value, valueColor }) => (
  <div>
    <div style={{
      fontSize: '10px',
      color: 'rgba(255,255,255,0.4)',
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      fontWeight: 600,
    }}>
      {label}
    </div>
    <div style={{
      fontSize: 'var(--font-body, 14px)',
      fontWeight: 'var(--font-weight-medium, 500)',
      color: valueColor ?? 'rgba(255,255,255,0.85)',
    }}>
      {value}
    </div>
  </div>
);

export default ReportGenerator;
