/**
 * Export a What-If run as JSON, CSV, or a printable PDF report.
 *
 * The document builders are pure string functions so their content can be
 * asserted in tests; only the three `download*` / `print*` wrappers touch the
 * DOM. PDF generation goes through the browser's own print-to-PDF rather than a
 * bundled PDF library: it adds no dependency, and the report is one page of
 * text and tables where print CSS is sufficient.
 */

import type { WhatIfResponse } from '../../types';
import {
  compareToClausiusClapeyron,
  confidenceLevel,
  CONFIDENCE_COPY,
  describeBeforeAfter,
  describeSensitivity,
  fmt,
  fmtCI,
  fmtPValue,
  fmtSigned,
  fmtVolume,
  orderEpochs,
  predictorById,
  regionLabel,
} from './whatIfFormat';
import type { PredictorId } from '../../types';

export interface WhatIfExportMeta {
  region: string;
  predictor: PredictorId;
  season: string;
  delta: number;
  windowStart?: string;
  windowEnd?: string;
  startYear?: number;
  endYear?: number;
  generatedAt?: string;
}

// ── JSON ──────────────────────────────────────────────────────────────────────

/**
 * Assemble the full export payload.
 *
 * Includes `method` and `interpretation` blocks alongside the raw numbers so a
 * downloaded file stands on its own: a reader six months later can tell what was
 * regressed against what, over which years, and how strong the fit was, without
 * needing the UI that produced it.
 */
export function buildWhatIfExport(
  result: WhatIfResponse,
  meta: WhatIfExportMeta,
): Record<string, unknown> {
  const level = confidenceLevel(result.fit);
  return {
    meta: {
      product: 'VAYU Climate Digital Twin — What-If sensitivity analysis',
      schema_version: '1.0',
      generated_at: meta.generatedAt ?? new Date().toISOString(),
      region: meta.region,
      region_label: regionLabel(meta.region),
      season: result.season,
      season_label: result.season_label,
      calendar_window:
        meta.windowStart && meta.windowEnd
          ? { start: meta.windowStart, end: meta.windowEnd }
          : null,
      year_range:
        meta.startYear && meta.endYear ? { start: meta.startYear, end: meta.endYear } : null,
      driver: {
        id: meta.predictor,
        label: predictorById(meta.predictor).label,
        applied_change: meta.delta,
        unit: result.fit.predictor_unit,
      },
    },
    method: {
      description:
        'Ordinary least squares of the seasonal-mean response on the seasonal-mean ' +
        'driver anomaly, fitted independently for the regional aggregate and for ' +
        'every grid cell. The per-cell slopes are then multiplied by the applied ' +
        'driver change to produce the scenario field.',
      response_denormalization:
        'Per-grid-cell z-score reversal using the companion norm_params climatology.',
      area_weighting: 'cos(latitude) for regional means; spherical band area for volumes.',
      uncertainty:
        'Regression standard error propagated through the applied change at the ' +
        '95% level. Observed epochs instead carry the interannual standard error of the mean.',
      ...(result.provenance ?? {}),
    },
    sensitivity: result.fit,
    regression_scatter: result.scatter,
    excluded_years: result.excluded_years,
    before_after: result.regional,
    domain_integral: result.integral,
    timeline: orderEpochs(result.epochs),
    spatial_distribution: result.distribution,
    hotspots: result.hotspots,
    interpretation: {
      confidence: level,
      confidence_label: CONFIDENCE_COPY[level].label,
      sensitivity_statement: describeSensitivity(result.fit, meta.region),
      before_after_statement: describeBeforeAfter(result),
      clausius_clapeyron_comparison: compareToClausiusClapeyron(result.fit),
      caveats: result.caveats,
    },
    grid:
      result.lats && result.lons
        ? {
            lats: result.lats,
            lons: result.lons,
            ordering: 'row-major (lat index * lon count + lon index)',
            cell_baseline: result.cell_baseline,
            cell_scenario: result.cell_scenario,
            cell_delta: result.cell_delta,
            cell_delta_percent: result.cell_delta_percent,
            cell_delta_uncertainty: result.cell_delta_uncertainty,
            cell_significant: result.cell_significant,
          }
        : null,
    computation_time_s: result.computation_time_s,
  };
}

export function whatIfToJson(result: WhatIfResponse, meta: WhatIfExportMeta): string {
  return JSON.stringify(buildWhatIfExport(result, meta), null, 2);
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export const WHATIF_CSV_COLUMNS = [
  'lat',
  'lon',
  'node_idx',
  'baseline',
  'scenario',
  'delta',
  'delta_percent',
  'delta_uncertainty_95',
  'significant',
] as const;

/**
 * Per-cell CSV of the before/after field.
 *
 * Emits the header alone when the response carried no grid, so a caller always
 * gets a valid CSV rather than an empty file.
 */
export function whatIfToCsv(result: WhatIfResponse): string {
  const header = WHATIF_CSV_COLUMNS.join(',');
  const { lats, lons, cell_baseline: base, cell_scenario: scen, cell_delta: delta } = result;
  if (!lats || !lons || !base || !scen || !delta) return header;

  const nLon = lons.length;
  const rows: string[] = [];
  for (let idx = 0; idx < base.length; idx += 1) {
    const b = base[idx];
    const s = scen[idx];
    const d = delta[idx];
    // Skip cells with no observations (ocean cells in a land-only rainfall grid).
    if (b === null || s === null || d === null) continue;
    const lat = lats[Math.floor(idx / nLon)];
    const lon = lons[idx % nLon];
    rows.push(
      [
        lat?.toFixed(4) ?? '',
        lon?.toFixed(4) ?? '',
        idx,
        b.toFixed(4),
        s.toFixed(4),
        d.toFixed(4),
        result.cell_delta_percent?.[idx]?.toFixed(2) ?? '',
        result.cell_delta_uncertainty?.[idx]?.toFixed(4) ?? '',
        result.cell_significant?.[idx] ? 'true' : 'false',
      ].join(','),
    );
  }
  return [header, ...rows].join('\n');
}

// ── Printable report ──────────────────────────────────────────────────────────

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statRow(label: string, value: string, note = ''): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td><td class="note">${escapeHtml(note)}</td></tr>`;
}

/**
 * Build a self-contained printable HTML report.
 *
 * Light-themed on purpose: the app UI is dark, and printing a dark theme wastes
 * ink and reads poorly on paper.
 */
export function buildWhatIfReportHtml(
  result: WhatIfResponse,
  meta: WhatIfExportMeta,
): string {
  const level = confidenceLevel(result.fit);
  const fit = result.fit;
  const driver = predictorById(meta.predictor);
  const generated = meta.generatedAt ?? new Date().toISOString();
  const ccNote = compareToClausiusClapeyron(fit);

  const epochRows = orderEpochs(result.epochs)
    .map(
      (e) => `<tr>
        <td>${escapeHtml(e.label)}</td>
        <td class="num">${fmt(e.value, 2)} ${escapeHtml(result.regional.unit)}</td>
        <td class="num">${e.uncertainty !== null ? `± ${fmt(e.uncertainty, 2)}` : '—'}</td>
        <td class="num">${e.id === 'current' ? '—' : fmtSigned(e.delta_vs_current, 2)}</td>
        <td>${e.observed ? 'Observed' : 'Projected'}</td>
      </tr>`,
    )
    .join('');

  const hotspotRows = result.hotspots
    .slice(0, 12)
    .map(
      (h) => `<tr>
        <td class="num">${fmt(h.lat, 2)}</td>
        <td class="num">${fmt(h.lon, 2)}</td>
        <td class="num">${fmtSigned(h.delta_value, 3)}</td>
        <td class="num">${h.delta_percent !== null ? `${fmtSigned(h.delta_percent, 1)}%` : '—'}</td>
        <td>${h.significant ? 'yes' : 'no'}</td>
      </tr>`,
    )
    .join('');

  const caveatItems = result.caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join('');
  const excluded = result.excluded_years.length
    ? result.excluded_years.join(', ')
    : 'none';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<title>VAYU What-If Report — ${escapeHtml(regionLabel(meta.region))}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #14181f; font-size: 11pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  h2 { font-size: 12.5pt; margin: 7mm 0 2mm; padding-bottom: 1mm;
       border-bottom: 1.5px solid #14181f; }
  .sub { color: #5b6472; font-size: 9.5pt; margin: 0 0 5mm; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 0; font-size: 10pt; }
  th, td { text-align: left; padding: 1.6mm 2mm; border-bottom: 1px solid #dfe3ea;
           vertical-align: top; }
  thead th { background: #f2f4f8; font-weight: 600; }
  th { font-weight: 600; width: 34%; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums;
                   font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  .note { color: #6b7484; font-size: 9pt; width: 30%; }
  .headline { font-size: 13pt; font-weight: 600; margin: 3mm 0; padding: 3mm 4mm;
              background: #f2f4f8; border-left: 4px solid #14181f; }
  .ba { display: flex; gap: 4mm; margin: 3mm 0; }
  .ba > div { flex: 1; border: 1px solid #cfd5df; padding: 3mm 4mm; }
  .ba .lbl { font-size: 8.5pt; letter-spacing: .09em; text-transform: uppercase;
             color: #6b7484; margin-bottom: 1mm; }
  .ba .val { font-size: 19pt; font-weight: 650; font-variant-numeric: tabular-nums; }
  .ba .unit { font-size: 9.5pt; color: #6b7484; font-weight: 400; }
  .badge { display: inline-block; padding: .6mm 2.5mm; border: 1px solid #14181f;
           font-size: 8.5pt; text-transform: uppercase; letter-spacing: .07em; }
  ul { margin: 2mm 0; padding-left: 6mm; }
  li { margin-bottom: 1.2mm; }
  footer { margin-top: 8mm; padding-top: 2mm; border-top: 1px solid #dfe3ea;
           color: #6b7484; font-size: 8.5pt; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<h1>What-If Sensitivity Analysis</h1>
<p class="sub">
  ${escapeHtml(regionLabel(meta.region))} &middot; ${escapeHtml(result.season_label)} &middot;
  driver: ${escapeHtml(driver.label)} ${fmtSigned(meta.delta, 2)} ${escapeHtml(fit.predictor_unit)}
  &middot; generated ${escapeHtml(generated)}
</p>

<div class="headline">${escapeHtml(describeBeforeAfter(result))}</div>

<h2>1. Observed sensitivity &part;R/&part;T</h2>
<p>${escapeHtml(describeSensitivity(fit, meta.region))}</p>
<table>
  ${statRow('Slope (∂R/∂T)', `${fmt(fit.slope, 4)} ${fit.slope_unit}`, 'Least-squares gradient')}
  ${statRow('Relative sensitivity', `${fmtSigned(fit.slope_percent_per_unit, 2)} % per ${fit.predictor_unit}`, 'As a share of the seasonal mean')}
  ${statRow('95% confidence interval', `${fmtCI(fit.ci95_low, fit.ci95_high, 4)} ${fit.slope_unit}`, 'On the slope')}
  ${statRow('Standard error', fmt(fit.std_err, 4), 'Of the slope')}
  ${statRow('Coefficient of determination', `r² = ${fmt(fit.r_squared, 3)}`, 'Share of interannual variance explained')}
  ${statRow('Significance', fmtPValue(fit.p_value), 'Two-sided t-test')}
  ${statRow('Sample size', `n = ${fit.n} seasons`, `Excluded years: ${excluded}`)}
  ${statRow('Driver climatology', `${fmt(fit.predictor_climatology, 2)} ${fit.predictor_unit}`, 'Mean over fitted years')}
  ${statRow('Response climatology', `${fmt(fit.response_climatology, 2)} ${fit.response_unit}`, 'Historical mean over the calendar range')}
  ${statRow('Assessment', CONFIDENCE_COPY[level].label, CONFIDENCE_COPY[level].detail)}
</table>
${ccNote ? `<p class="sub" style="margin-top:3mm">${escapeHtml(ccNote)}</p>` : ''}

<h2>2. Before and after</h2>
<div class="ba">
  <div>
    <div class="lbl">Before &middot; observed baseline</div>
    <div class="val">${fmt(result.regional.baseline, 2)}
      <span class="unit">${escapeHtml(result.regional.unit)}</span></div>
  </div>
  <div>
    <div class="lbl">After &middot; projected</div>
    <div class="val">${fmt(result.regional.scenario, 2)}
      <span class="unit">${escapeHtml(result.regional.unit)}</span></div>
  </div>
  <div>
    <div class="lbl">Change</div>
    <div class="val">${fmtSigned(result.regional.delta, 2)}
      <span class="unit">${escapeHtml(result.regional.unit)}</span></div>
    <div class="sub" style="margin:1mm 0 0">${fmtSigned(result.regional.delta_percent, 1)}% &middot;
      95% CI ${fmtCI(result.regional.delta_ci95_low, result.regional.delta_ci95_high, 2)}</div>
  </div>
</div>
<table>
  ${statRow('Domain water volume, baseline', fmtVolume(result.integral.baseline_volume_km3), 'Area integral over the window')}
  ${statRow('Domain water volume, change', fmtVolume(result.integral.delta_volume_km3), 'Area integral of ∂R/∂T · ΔT')}
  ${statRow('Region area', `${fmt(result.integral.area_km2, 0)} km²`, 'Cells with observations')}
</table>

<h2>3. Past, current and projected</h2>
<table>
  <thead><tr><th>Period</th><th class="num">Mean</th><th class="num">± 95%</th>
    <th class="num">vs current</th><th>Basis</th></tr></thead>
  <tbody>${epochRows}</tbody>
</table>

<h2>4. Spatial response</h2>
<table>
  ${statRow('Cells drier', `${result.distribution.cells_drier} of ${result.distribution.cells_total}`, '')}
  ${statRow('Cells wetter', `${result.distribution.cells_wetter} of ${result.distribution.cells_total}`, '')}
  ${statRow('Cells with a significant local slope', `${result.distribution.cells_significant} of ${result.distribution.cells_total}`, 'p < 0.05 per cell')}
  ${statRow('Cells clamped to physical bounds', String(result.distribution.clamped_cells), '')}
</table>
${
  hotspotRows
    ? `<table><thead><tr><th class="num">Lat</th><th class="num">Lon</th>
        <th class="num">Δ ${escapeHtml(result.regional.unit)}</th><th class="num">Δ %</th>
        <th>Significant</th></tr></thead><tbody>${hotspotRows}</tbody></table>`
    : ''
}

<h2>5. Limits of this result</h2>
<ul>${caveatItems}</ul>

<footer>
  VAYU Climate Digital Twin &middot; sensitivity regressed from the observed 1981&ndash;2025 record
  (IMD gridded rainfall and temperature, CHIRPS, NOAA OISST, NCEP reanalysis).
  Computed in ${fmt(result.computation_time_s, 3)} s.
  Past and current figures are measurements; the projected figure is a regression
  extrapolation, not a forecast.
</footer>
</body></html>`;
}

// ── Browser side effects ──────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Stable, sortable filename stem for a run. */
export function whatIfFilename(meta: WhatIfExportMeta, ext: string): string {
  const stamp = (meta.generatedAt ?? new Date().toISOString()).slice(0, 10);
  const delta = `${meta.delta >= 0 ? 'p' : 'm'}${Math.abs(meta.delta).toFixed(2).replace('.', '')}`;
  return `vayu_whatif_${meta.region}_${meta.season}_${meta.predictor}_${delta}_${stamp}.${ext}`;
}

export function downloadWhatIfJson(result: WhatIfResponse, meta: WhatIfExportMeta): void {
  triggerDownload(
    new Blob([whatIfToJson(result, meta)], { type: 'application/json' }),
    whatIfFilename(meta, 'json'),
  );
}

export function downloadWhatIfCsv(result: WhatIfResponse, meta: WhatIfExportMeta): void {
  triggerDownload(
    new Blob([whatIfToCsv(result)], { type: 'text/csv;charset=utf-8;' }),
    whatIfFilename(meta, 'csv'),
  );
}

/**
 * Open the report in a new window and invoke the print dialog, where the user
 * picks "Save as PDF".
 *
 * Returns false when the window could not be opened (pop-up blocker), so the
 * caller can surface that instead of appearing to do nothing.
 */
export function printWhatIfReport(result: WhatIfResponse, meta: WhatIfExportMeta): boolean {
  if (typeof window === 'undefined') return false;
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return false;

  win.document.open();
  win.document.write(buildWhatIfReportHtml(result, meta));
  win.document.close();
  // Defer until layout settles, otherwise Chrome can print a blank first page.
  win.setTimeout(() => {
    win.focus();
    win.print();
  }, 350);
  return true;
}
