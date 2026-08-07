/**
 * Before/after heatmap comparison for a What-If run.
 *
 * Three rasters side by side — baseline, scenario, delta — drawn from the
 * per-cell arrays the API returns when `include_cells` is true.
 *
 * Two decisions here are the whole point of the panel:
 *
 *   1. Baseline and scenario share ONE colour scale and ONE min/max domain,
 *      computed across both arrays. Scaled independently, a scenario that is
 *      20 % drier everywhere would render pixel-identical to the baseline —
 *      both would stretch their own range across the full ramp — and a reader
 *      would conclude nothing changed. The shared domain is printed in the
 *      legend so the claim is checkable.
 *   2. The delta uses a diverging ramp centred on zero and symmetric about the
 *      largest |delta|, so the neutral midpoint is always exactly zero. A
 *      min→max diverging scale would put the neutral colour at whatever value
 *      happened to sit halfway, which mislabels sign.
 *
 * Nothing is invented: a cell with a null or non-finite value is left fully
 * transparent rather than painted as zero, and if the coastline mask fails to
 * load the rasters render unclipped with a visible note rather than silently
 * asserting rainfall over the Arabian Sea.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, LayoutGrid } from 'lucide-react';

import type { WhatIfResponse } from '../../types';
import {
  clipCanvasToIndia,
  parseIndiaOutline,
  strokeIndiaOutline,
  type LonLatBounds,
  type Polygon,
} from '../globe/indiaClip';
import { mapColor } from '../../utils/colorScales';
import { fmt, fmtCI, fmtSigned, regionLabel } from './whatIfFormat';

export interface WhatIfHeatmapCompareProps {
  result: WhatIfResponse;
}

// ── Pure geometry / domain helpers (unit-tested directly) ─────────────────────

export interface Domain {
  min: number;
  max: number;
}

/** Grid extracted from a response, validated as internally consistent. */
export interface CellGrid {
  lats: number[];
  lons: number[];
  nLat: number;
  nLon: number;
  /** Cell-edge bounds, i.e. centres expanded by half a grid step. */
  bounds: LonLatBounds;
  baseline: (number | null)[];
  scenario: (number | null)[];
  delta: (number | null)[] | null;
  significant: boolean[] | null;
}

export type CellGridResult =
  | { ok: true; grid: CellGrid }
  | { ok: false; message: string };

/**
 * Half of the smallest positive spacing in a coordinate axis.
 *
 * Used to turn cell *centres* into cell *edges*. Falls back to 0.125°, half of
 * the 0.25° product grid, when a single coordinate makes the spacing
 * unknowable — that is a labelled assumption about one degenerate axis, not a
 * guess at the grid shape.
 */
export function halfStep(values: number[]): number {
  let smallest = Infinity;
  for (let i = 1; i < values.length; i += 1) {
    const d = Math.abs(values[i] - values[i - 1]);
    if (d > 0 && d < smallest) smallest = d;
  }
  return Number.isFinite(smallest) ? smallest / 2 : 0.125;
}

/** Cell-edge lon/lat bounds for a centre-referenced grid. */
export function gridBounds(lats: number[], lons: number[]): LonLatBounds {
  const dLat = halfStep(lats);
  const dLon = halfStep(lons);
  return {
    west: Math.min(...lons) - dLon,
    east: Math.max(...lons) + dLon,
    south: Math.min(...lats) - dLat,
    north: Math.max(...lats) + dLat,
  };
}

/**
 * Pull the per-cell grid out of a response, or explain why it cannot be drawn.
 *
 * The API omits every `cell_*` array when `include_cells` is false, and a
 * length mismatch would mean the row-major mapping `lat_i * nLon + lon_j` no
 * longer addresses the cell it claims to. Both cases return a message instead
 * of a reshaped or padded array: inferring dimensions here would silently
 * relabel the map.
 */
export function extractCellGrid(result: WhatIfResponse): CellGridResult {
  const { lats, lons, cell_baseline: baseline, cell_scenario: scenario } = result;

  if (!lats?.length || !lons?.length) {
    return {
      ok: false,
      message:
        'This response carries no grid coordinates, so there is nothing to map. Re-run the ' +
        'analysis with per-cell output enabled to see the before/after rasters.',
    };
  }
  if (!baseline?.length || !scenario?.length) {
    return {
      ok: false,
      message:
        'This response carries grid coordinates but no per-cell baseline and scenario fields. ' +
        'Re-run the analysis with per-cell output enabled to see the before/after rasters.',
    };
  }

  const nLat = lats.length;
  const nLon = lons.length;
  const expected = nLat * nLon;

  const mismatched: string[] = [];
  if (baseline.length !== expected) mismatched.push(`cell_baseline (${baseline.length})`);
  if (scenario.length !== expected) mismatched.push(`cell_scenario (${scenario.length})`);
  if (result.cell_delta && result.cell_delta.length !== expected) {
    mismatched.push(`cell_delta (${result.cell_delta.length})`);
  }
  if (result.cell_significant && result.cell_significant.length !== expected) {
    mismatched.push(`cell_significant (${result.cell_significant.length})`);
  }
  if (mismatched.length > 0) {
    return {
      ok: false,
      message:
        `Grid arrays do not match the ${nLat} × ${nLon} = ${expected} cell coordinates: ` +
        `${mismatched.join(', ')}. The rasters are not drawn because the row-major mapping ` +
        'from index to latitude and longitude would be wrong.',
    };
  }

  return {
    ok: true,
    grid: {
      lats,
      lons,
      nLat,
      nLon,
      bounds: gridBounds(lats, lons),
      baseline,
      scenario,
      delta: result.cell_delta ?? null,
      significant: result.cell_significant ?? null,
    },
  };
}

/**
 * One min/max domain spanning every supplied array.
 *
 * Returns null when no finite value exists at all, so callers render a message
 * rather than a ramp over an empty range. A flat field (min === max) is padded
 * by ±0.5 so the normalisation below cannot divide by zero.
 */
export function computeSharedDomain(
  ...arrays: (readonly (number | null | undefined)[] | undefined | null)[]
): Domain | null {
  let min = Infinity;
  let max = -Infinity;
  for (const array of arrays) {
    if (!array) continue;
    for (const v of array) {
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max - min <= 0) return { min: min - 0.5, max: max + 0.5 };
  return { min, max };
}

/**
 * Domain for the delta raster: symmetric about zero.
 *
 * `max = -min = max|delta|`, which puts zero exactly at the ramp's neutral
 * midpoint no matter how lopsided the field is. An all-zero field gets a ±1
 * range so every cell lands on the neutral colour instead of dividing by zero.
 */
export function computeDivergingDomain(
  values: readonly (number | null | undefined)[] | undefined | null,
): Domain | null {
  if (!values) return null;
  let magnitude = -Infinity;
  for (const v of values) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const abs = Math.abs(v);
    if (abs > magnitude) magnitude = abs;
  }
  if (!Number.isFinite(magnitude)) return null;
  const m = magnitude > 0 ? magnitude : 1;
  return { min: -m, max: m };
}

/** Position of a value in a domain, clamped to [0, 1]. */
export function domainT(value: number, domain: Domain): number {
  const span = domain.max - domain.min;
  if (!(span > 0)) return 0.5;
  return Math.min(1, Math.max(0, (value - domain.min) / span));
}

export interface CellCounts {
  valid: number;
  wetter: number;
  drier: number;
  neutral: number;
  significant: number;
}

/**
 * Count the sign of the response per cell, plus locally significant cells.
 *
 * Null and non-finite deltas are excluded from `valid` entirely — they are
 * cells without observations, not cells with no change.
 */
export function cellCounts(
  delta: readonly (number | null | undefined)[] | undefined | null,
  significant: readonly boolean[] | undefined | null,
): CellCounts {
  const counts: CellCounts = { valid: 0, wetter: 0, drier: 0, neutral: 0, significant: 0 };
  if (!delta) return counts;
  delta.forEach((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    counts.valid += 1;
    if (v > 0) counts.wetter += 1;
    else if (v < 0) counts.drier += 1;
    else counts.neutral += 1;
    if (significant?.[i]) counts.significant += 1;
  });
  return counts;
}

// ── Colour ramps ──────────────────────────────────────────────────────────────

/** Sequential ramp shared by baseline and scenario. */
const sequentialColor = (t: number): string => mapColor(t, 'blues', 0.92);

/**
 * Diverging ramp for the delta, red/amber at the drying end.
 *
 * `rdbu_r` runs blue → white → red, i.e. red at high `t`. Drying is *negative*
 * rainfall change and therefore low `t`, so the ramp is read backwards
 * (`1 - t`). That keeps a single colormap definition rather than adding a
 * near-duplicate to the registry.
 */
const divergingColor = (t: number): string => mapColor(1 - t, 'rdbu_r', 0.92);

/** CSS gradient for a legend swatch, sampled from the same function as the raster. */
function rampCss(colorAt: (t: number) => string, steps = 16): string {
  const stops: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    stops.push(`${colorAt(i / steps)} ${((100 * i) / steps).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

// ── Component ─────────────────────────────────────────────────────────────────

type OutlineStatus = 'loading' | 'ready' | 'unavailable';

export default function WhatIfHeatmapCompare({ result }: WhatIfHeatmapCompareProps) {
  const [outline, setOutline] = useState<Polygon[] | null>(null);
  const [outlineStatus, setOutlineStatus] = useState<OutlineStatus>('loading');

  // Fetched once for all three canvases so the rasters cannot disagree about
  // where the coastline is.
  useEffect(() => {
    let cancelled = false;
    fetch('/india_outline_simplified.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`outline HTTP ${res.status}`);
        return res.json();
      })
      .then((geojson) => {
        if (cancelled) return;
        const polygons = parseIndiaOutline(geojson);
        if (polygons.length === 0) throw new Error('outline contained no polygons');
        setOutline(polygons);
        setOutlineStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setOutline(null);
        setOutlineStatus('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const extracted = extractCellGrid(result);
  const unit = result.regional.unit;
  const variable = result.fit.response;

  return (
    <section aria-labelledby="whatif-heatmap-heading" className="panel p-4 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2
          id="whatif-heatmap-heading"
          className="text-foreground font-semibold text-base tracking-wide flex items-center gap-2"
        >
          <LayoutGrid size={16} className="text-sky-400" />
          Before / after maps
        </h2>
        <p className="text-xs text-foreground/50 leading-snug">
          {regionLabel(result.region)} &middot; {result.season_label} &middot; per-cell{' '}
          {variable} in {unit} under a {fmtSigned(result.delta_predictor, 2)}{' '}
          {result.fit.predictor_unit} change.
        </p>
      </header>

      {!extracted.ok ? (
        <div className="flex gap-2 p-3 bg-foreground/[0.04] border border-foreground/12 rounded-lg">
          <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-foreground/70 leading-snug" data-testid="heatmap-unavailable">
            {extracted.message}
          </p>
        </div>
      ) : (
        <HeatmapBody
          grid={extracted.grid}
          result={result}
          outline={outline}
          outlineStatus={outlineStatus}
        />
      )}
    </section>
  );
}

// ── Body ──────────────────────────────────────────────────────────────────────

function HeatmapBody({
  grid,
  result,
  outline,
  outlineStatus,
}: {
  grid: CellGrid;
  result: WhatIfResponse;
  outline: Polygon[] | null;
  outlineStatus: OutlineStatus;
}) {
  const unit = result.regional.unit;
  const variable = result.fit.response;

  const shared = computeSharedDomain(grid.baseline, grid.scenario);
  const diverging = computeDivergingDomain(grid.delta);
  const counts = cellCounts(grid.delta, grid.significant);
  const { regional } = result;

  if (!shared) {
    return (
      <p className="text-xs text-foreground/60">
        Every cell in the returned grid is empty, so no raster can be drawn. Nothing is filled in
        with zero.
      </p>
    );
  }

  const domainText = `${fmt(shared.min, 2)} – ${fmt(shared.max, 2)} ${unit}`;

  return (
    <div className="flex flex-col gap-4">
      {outlineStatus === 'unavailable' && (
        <div className="flex gap-2 p-2.5 caveat-box">
          <Info size={13} className="caveat-icon mt-0.5 shrink-0" />
          <p className="text-xs caveat-text leading-relaxed">
            The coastline mask could not be loaded, so these rasters show the full model rectangle
            including ocean and cross-border cells. Treat colour outside India&apos;s land area as
            grid padding, not as a result.
          </p>
        </div>
      )}

      {/* ── The three rasters ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <HeatmapCanvas
          caption="Baseline"
          sublabel="Observed mean"
          grid={grid}
          values={grid.baseline}
          domain={shared}
          colorAt={sequentialColor}
          outline={outline}
          ariaLabel={
            `Baseline ${variable} map for ${regionLabel(result.region)} on a ${grid.nLat} by ` +
            `${grid.nLon} grid, coloured from ${fmt(shared.min, 2)} to ${fmt(shared.max, 2)} ${unit} ` +
            'on the scale shared with the scenario map.'
          }
        />
        <HeatmapCanvas
          caption="Scenario"
          sublabel={`At ${fmtSigned(result.delta_predictor, 2)} ${result.fit.predictor_unit}`}
          grid={grid}
          values={grid.scenario}
          domain={shared}
          colorAt={sequentialColor}
          projected
          ariaLabel={
            `Projected ${variable} map for ${regionLabel(result.region)} on a ${grid.nLat} by ` +
            `${grid.nLon} grid, coloured from ${fmt(shared.min, 2)} to ${fmt(shared.max, 2)} ${unit} ` +
            'on the same scale as the baseline map so the two are directly comparable.'
          }
          outline={outline}
        />
        {diverging && grid.delta ? (
          <HeatmapCanvas
            caption="Change"
            sublabel="Scenario − baseline"
            grid={grid}
            values={grid.delta}
            domain={diverging}
            colorAt={divergingColor}
            outline={outline}
            ariaLabel={
              `Change in ${variable} per cell, from ${fmt(diverging.min, 2)} to ` +
              `${fmt(diverging.max, 2)} ${unit} on a diverging scale centred on zero: red and amber ` +
              `where ${variable} falls, blue where it rises. ${counts.drier} of ${counts.valid} ` +
              `cells drier, ${counts.wetter} wetter.`
            }
          />
        ) : (
          <div className="rounded-lg bg-foreground/[0.04] border border-foreground/12 p-3">
            <p className="text-xs text-foreground/55">
              No per-cell change field was returned, so the difference map is omitted rather than
              recomputed from rounded values.
            </p>
          </div>
        )}
      </div>

      {/* ── Legends ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Legend
          label="Baseline & scenario (shared scale)"
          ramp={rampCss(sequentialColor)}
          lowText={`${fmt(shared.min, 2)} ${unit}`}
          highText={`${fmt(shared.max, 2)} ${unit}`}
          note={
            `One domain across both maps: ${domainText}. Scaled separately, a uniformly drier ` +
            'scenario would look identical to the baseline.'
          }
          testId="shared-domain-legend"
          testValue={`shared domain ${fmt(shared.min, 2)} to ${fmt(shared.max, 2)} ${unit}`}
        />
        {diverging && (
          <Legend
            label="Change (diverging, zero-centred)"
            ramp={rampCss(divergingColor)}
            lowText={`${fmtSigned(diverging.min, 2)} ${unit} (drier)`}
            highText={`${fmtSigned(diverging.max, 2)} ${unit} (wetter)`}
            note={
              'Symmetric about the largest change, so the neutral midpoint is exactly zero. ' +
              'Sign is also stated in the counts below, so colour is never the only signal.'
            }
            testId="delta-domain-legend"
          />
        )}
      </div>

      {/* ── Summary row ──────────────────────────────────────────────────── */}
      <div
        className="rounded-lg bg-foreground/[0.04] border border-foreground/12 p-3 flex flex-col gap-2"
        data-testid="regional-summary"
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[10px] uppercase tracking-wider text-foreground/45">
            Regional mean
          </span>
          <span className="font-mono text-sm text-foreground/90">
            {fmt(regional.baseline, 2)} {unit}
          </span>
          <span className="text-foreground/40" aria-hidden="true">
            &rarr;
          </span>
          <span className="font-mono text-sm text-foreground/90">
            {fmt(regional.scenario, 2)} {unit}
          </span>
          <span
            className={`font-mono text-sm font-semibold ${
              (regional.delta ?? 0) < 0 ? 'text-amber-400' : 'text-sky-400'
            }`}
          >
            {fmtSigned(regional.delta, 2)} {unit}
          </span>
          <span className="text-xs text-foreground/55">
            95 % CI{' '}
            <span className="font-mono text-foreground/80">
              {fmtCI(regional.delta_ci95_low, regional.delta_ci95_high, 2)}
            </span>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-foreground/65">
          <span>
            Cells mapped:{' '}
            <span className="font-mono text-foreground/85">{counts.valid}</span>
          </span>
          <span>
            Drier (&minus;): <span className="font-mono text-amber-300">{counts.drier}</span>
          </span>
          <span>
            Wetter (+): <span className="font-mono text-sky-300">{counts.wetter}</span>
          </span>
          <span>
            Locally significant:{' '}
            <span className="font-mono text-foreground/85">{counts.significant}</span>
          </span>
        </div>
        <p className="text-[10px] text-foreground/35 leading-snug">
          Cells without observations are left transparent in all three maps, never drawn as zero.
          {counts.valid > 0 && counts.significant < counts.valid / 2 && (
            <>
              {' '}
              Fewer than half the mapped cells clear p &lt; 0.05 locally, so read the regional mean
              above rather than any single cell.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ── Canvas ────────────────────────────────────────────────────────────────────

/** Target raster width in device pixels; height follows the grid's aspect. */
const CANVAS_WIDTH = 260;

function HeatmapCanvas({
  caption,
  sublabel,
  grid,
  values,
  domain,
  colorAt,
  outline,
  ariaLabel,
  projected = false,
}: {
  caption: string;
  sublabel: string;
  grid: CellGrid;
  values: (number | null)[];
  domain: Domain;
  colorAt: (t: number) => string;
  outline: Polygon[] | null;
  ariaLabel: string;
  projected?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { bounds } = grid;
  const lonSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  const height =
    lonSpan > 0 && latSpan > 0
      ? Math.min(360, Math.max(110, Math.round((CANVAS_WIDTH * latSpan) / lonSpan)))
      : 180;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // jsdom has no 2D context; the panel's text, counts, and aria labels carry
    // the result, so a missing context is a no-op rather than an error.
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!(lonSpan > 0) || !(latSpan > 0)) return;

    const dLat = halfStep(grid.lats);
    const dLon = halfStep(grid.lons);
    const pxPerLon = canvas.width / lonSpan;
    const pxPerLat = canvas.height / latSpan;

    for (let i = 0; i < grid.nLat; i += 1) {
      const lat = grid.lats[i];
      // Latitude is drawn from the north edge down, so the raster is not
      // upside-down regardless of whether `lats` ascends or descends.
      const top = ((bounds.north - (lat + dLat)) / latSpan) * canvas.height;
      for (let j = 0; j < grid.nLon; j += 1) {
        const value = values[i * grid.nLon + j];
        if (value === null || value === undefined || !Number.isFinite(value)) continue;
        const left = ((grid.lons[j] - dLon - bounds.west) / lonSpan) * canvas.width;
        ctx.fillStyle = colorAt(domainT(value, domain));
        // +1px so neighbouring cells butt together instead of leaving seams.
        ctx.fillRect(
          Math.floor(left),
          Math.floor(top),
          Math.ceil(2 * dLon * pxPerLon) + 1,
          Math.ceil(2 * dLat * pxPerLat) + 1,
        );
      }
    }

    clipCanvasToIndia(ctx, canvas.width, canvas.height, bounds, outline);
    strokeIndiaOutline(ctx, canvas.width, canvas.height, bounds, outline);
  }, [grid, values, domain, colorAt, outline, bounds, lonSpan, latSpan, height]);

  return (
    <figure className="flex flex-col gap-1.5 m-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
          {caption}
        </span>
        <span className="text-[10px] text-foreground/40">{sublabel}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={height}
        role="img"
        aria-label={ariaLabel}
        className={`w-full h-auto rounded-md bg-foreground/[0.04] border ${
          projected ? 'border-dashed border-foreground/30' : 'border-foreground/12'
        }`}
      />
      <figcaption className="text-[10px] text-foreground/35 leading-snug">
        {projected ? 'Extrapolated from the fitted sensitivity.' : 'Measured field.'}
      </figcaption>
    </figure>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({
  label,
  ramp,
  lowText,
  highText,
  note,
  testId,
  testValue,
}: {
  label: string;
  ramp: string;
  lowText: string;
  highText: string;
  note: string;
  testId: string;
  testValue?: string;
}) {
  return (
    <div
      className="rounded-lg bg-foreground/[0.04] border border-foreground/12 p-2.5 flex flex-col gap-1.5"
      data-testid={testId}
      data-domain={testValue}
    >
      <span className="text-[10px] uppercase tracking-wider text-foreground/45">{label}</span>
      <div
        className="h-2.5 w-full rounded-full border border-foreground/12"
        style={{ background: ramp }}
        aria-hidden="true"
      />
      <div className="flex justify-between text-[10px] font-mono text-foreground/60">
        <span>{lowText}</span>
        <span>{highText}</span>
      </div>
      <p className="text-[10px] text-foreground/35 leading-snug">{note}</p>
    </div>
  );
}
