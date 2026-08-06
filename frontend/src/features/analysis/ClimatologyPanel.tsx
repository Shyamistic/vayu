/**
 * Historical climatology panel — the observed mean of a variable over a calendar
 * range, year by year.
 *
 * This is the number every projection elsewhere in the app is expressed against,
 * so it is deliberately rendered from the API response only. There is no offline
 * estimate and no demo series: a fabricated baseline would silently rebase every
 * downstream figure, which is worse than an empty panel.
 *
 * Bars are hand-drawn CSS divs rather than a chart library, matching
 * WhatIfBeforeAfter.tsx — the point of the chart is the sign of each anomaly
 * against the mean line, which needs no plotting engine.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarRange, Info, RefreshCw } from 'lucide-react';

import { fetchClimatology } from '../../api/client';
import type { ClimatologyResponse, ClimatologyYear, SeasonId } from '../../types';
import { fmt, fmtCI, fmtPValue, fmtSigned, regionLabel, SEASONS } from './whatIfFormat';

export type ClimatologyVariable = 'rainfall' | 'tmax' | 'tmin' | 'sst' | 'lst';

export interface ClimatologyPanelProps {
  region: string;
  season: SeasonId;
  /** Defaults to rainfall, the variable the volume integral is defined for. */
  variable?: ClimatologyVariable;
  windowStart?: string;
  windowEnd?: string;
  startYear?: number;
  endYear?: number;
  /** Fetch on mount and whenever the query-shaping props change. */
  autoLoad?: boolean;
}

const VARIABLE_LABELS: Record<ClimatologyVariable, string> = {
  rainfall: 'Rainfall',
  tmax: 'Maximum temperature',
  tmin: 'Minimum temperature',
  sst: 'Sea-surface temperature',
  lst: 'Land-surface temperature',
};

/** Chart plot height in px. Fixed so the mean line and bars share one scale. */
const PLOT_HEIGHT = 132;

function seasonLabel(season: SeasonId): string {
  return SEASONS.find((s) => s.id === season)?.label ?? season;
}

export default function ClimatologyPanel({
  region,
  season,
  variable = 'rainfall',
  windowStart,
  windowEnd,
  startYear,
  endYear,
  autoLoad = false,
}: ClimatologyPanelProps) {
  const [data, setData] = useState<ClimatologyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchClimatology({
        region,
        variable,
        season,
        windowStart,
        windowEnd,
        startYear,
        endYear,
      });
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — no offline estimate is shown because these figures come from the observed record.`
          : 'Climatology unavailable — no offline estimate is shown because these figures come from the observed record.',
      );
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [region, variable, season, windowStart, windowEnd, startYear, endYear]);

  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  const varLabel = VARIABLE_LABELS[variable];

  return (
    <section
      aria-labelledby="climatology-heading"
      className="panel p-4 flex flex-col gap-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="climatology-heading"
            className="text-foreground font-semibold text-base tracking-wide flex items-center gap-2"
          >
            <CalendarRange size={16} className="text-sky-400" />
            Historical mean {varLabel.toLowerCase()}
          </h2>
          <p className="text-xs text-foreground/50 leading-snug">
            {regionLabel(region)} &middot; {data?.season_label ?? seasonLabel(season)}
            {windowStart && windowEnd ? ` · ${windowStart} → ${windowEnd}` : ''} &middot; averaged
            over exactly this calendar range in every year of the record.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={isLoading}
          aria-label={data ? 'Refresh historical climatology' : 'Load historical climatology'}
          className="btn-ghost flex items-center gap-1.5 text-xs shrink-0"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : undefined} />
          {isLoading ? 'Loading…' : data ? 'Refresh' : 'Load'}
        </button>
      </header>

      {error && (
        <div className="flex gap-2 p-3 bg-red-500/15 border border-red-500/30 rounded-lg">
          <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-200 leading-snug">{error}</p>
        </div>
      )}

      {!data && !error && !isLoading && (
        <p className="text-xs text-foreground/40">
          Load the observed record to see the mean, its interval, and the year-by-year series.
        </p>
      )}

      {data && <ClimatologyBody data={data} varLabel={varLabel} />}
    </section>
  );
}

// ── Result body ───────────────────────────────────────────────────────────────

function ClimatologyBody({
  data,
  varLabel,
}: {
  data: ClimatologyResponse;
  varLabel: string;
}) {
  const { summary, trend, integral, per_year: perYear, excluded_years: excluded } = data;
  const unit = data.unit;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Headline ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-foreground/45">
          Observed mean, {summary.year_first}&ndash;{summary.year_last}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-bold font-mono text-sky-300 leading-none">
            {fmt(summary.mean, 3)}
          </span>
          <span className="text-xs text-foreground/55">{unit}</span>
          <span className="text-xs text-foreground/60">
            95 % CI{' '}
            <span className="font-mono text-foreground/85">
              {fmtCI(summary.ci95_low, summary.ci95_high, 3)}
            </span>{' '}
            {unit}
          </span>
        </div>
        <p className="text-[10px] text-foreground/40">
          Interval is on the mean itself (± {fmt(summary.sem, 3)} standard error of {summary.n_years}{' '}
          seasons), not the spread of individual years.
        </p>
      </div>

      {/* ── Stat row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Median" value={fmt(summary.median, 3)} unit={unit} note="middle season" />
        <Stat
          label="Interannual spread"
          value={fmt(summary.std, 3)}
          unit={unit}
          note="σ across years, not within a season"
        />
        <Stat label="Seasons used" value={String(summary.n_years)} unit="" note="years in the mean" />
        <Stat
          label="Year range"
          value={`${summary.year_first}–${summary.year_last}`}
          unit=""
          note="observed record"
        />
      </div>

      {integral.volume_km3 !== null && Number.isFinite(integral.volume_km3) && (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Water volume"
            value={fmt(integral.volume_km3, 0)}
            unit="km³"
            note={integral.definition || 'Area integral over the region'}
          />
          <Stat
            label="Region area"
            value={fmt(integral.area_km2, 0)}
            unit="km²"
            note="cells with observations"
          />
        </div>
      )}

      {/* ── Extremes ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <ExtremeCard
          caption="Driest year"
          arrow="↓"
          year={summary.min_year}
          value={summary.min_value}
          mean={summary.mean}
          unit={unit}
          tone="amber"
        />
        <ExtremeCard
          caption="Wettest year"
          arrow="↑"
          year={summary.max_year}
          value={summary.max_value}
          mean={summary.mean}
          unit={unit}
          tone="sky"
        />
      </div>

      {/* ── Trend ──────────────────────────────────────────────────────────── */}
      <div
        className={`flex flex-col gap-1 rounded-lg border p-3 ${
          trend.significant
            ? 'border-emerald-400/30 bg-emerald-400/[0.07]'
            : 'border-foreground/12 bg-foreground/[0.04]'
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">
            Trend per decade
          </span>
          <span
            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border ${
              trend.significant
                ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200'
                : 'border-foreground/20 bg-foreground/[0.06] text-foreground/60'
            }`}
          >
            {trend.significant ? 'Significant (p < 0.05)' : 'Not significant'}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xl font-bold font-mono text-foreground leading-none">
            {fmtSigned(trend.per_decade, 3)}
          </span>
          <span className="text-xs text-foreground/55">{trend.unit || `${unit} / decade`}</span>
          <span className="text-xs font-mono text-foreground/70">{fmtPValue(trend.p_value)}</span>
          <span className="text-xs text-foreground/50">r² {fmt(trend.r_squared, 3)}</span>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          {trend.significant
            ? `Over ${summary.n_years} seasons the record shows a detectable drift in ${varLabel.toLowerCase()}.`
            : `The record does not demonstrate a trend at the 95 % level, so the per-decade number above is not a finding — treat it as an unresolved slope rather than a change.`}
        </p>
      </div>

      {/* ── Per-year bars ──────────────────────────────────────────────────── */}
      <YearBars perYear={perYear} mean={summary.mean} unit={unit} varLabel={varLabel} />

      {excluded.length > 0 && (
        <div className="flex gap-2 p-2.5 bg-amber-500/[0.07] border border-amber-500/25 rounded-lg">
          <Info size={13} className="text-amber-300/90 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-100/85 leading-relaxed">
            Excluded from every figure above:{' '}
            <span className="font-mono">{excluded.join(', ')}</span>. These years fell below the
            valid-day coverage floor for the calendar range, so averaging them would mix a partial
            season with complete ones.
          </p>
        </div>
      )}

      <p className="text-[10px] text-foreground/25 leading-snug">
        Source: {provenanceLine(data)}
      </p>
    </div>
  );
}

/** Flatten the provenance bag into one readable footer line. */
function provenanceLine(data: ClimatologyResponse): string {
  const parts = Object.entries(data.provenance)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`);
  const head = `${regionLabel(data.region)} · ${data.variable} · ${data.season_label}`;
  return parts.length > 0 ? `${head} · ${parts.join(' · ')}` : head;
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function YearBars({
  perYear,
  mean,
  unit,
  varLabel,
}: {
  perYear: ClimatologyYear[];
  mean: number | null;
  unit: string;
  varLabel: string;
}) {
  const values = perYear
    .map((y) => y.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  if (values.length === 0) {
    return (
      <p className="text-xs text-foreground/45">
        No per-year values were returned for this calendar range.
      </p>
    );
  }

  const max = Math.max(...values);
  const heightPct = (v: number | null): number =>
    v !== null && Number.isFinite(v) && max > 0 ? Math.max(2, (100 * v) / max) : 0;
  const meanPct = mean !== null && Number.isFinite(mean) && max > 0 ? (100 * mean) / max : null;

  const first = perYear[0]?.year;
  const last = perYear[perYear.length - 1]?.year;

  return (
    <div className="flex flex-col gap-2" aria-labelledby="climatology-series-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          id="climatology-series-heading"
          className="text-sm font-semibold text-foreground/90 tracking-wide uppercase"
        >
          Season by season
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-foreground/50">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/70" aria-hidden="true" />
            below mean (−)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500/70" aria-hidden="true" />
            above mean (+)
          </span>
        </div>
      </div>

      <div
        className="relative flex items-end gap-px border-b border-foreground/12 pb-0"
        style={{ height: PLOT_HEIGHT }}
        role="img"
        aria-label={
          `Annual mean ${varLabel.toLowerCase()} in ${unit} for each season from ${first ?? '?'} to ` +
          `${last ?? '?'}, with a reference line at the record mean of ${fmt(mean, 3)} ${unit}.`
        }
      >
        {meanPct !== null && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-foreground/45"
            style={{ bottom: `${Math.min(100, meanPct)}%` }}
            aria-hidden="true"
          >
            <span className="absolute -top-3.5 right-0 text-[9px] font-mono text-foreground/50">
              mean {fmt(mean, 2)} {unit}
            </span>
          </div>
        )}

        {perYear.map((y) => {
          const below = y.anomaly !== null && Number.isFinite(y.anomaly) && y.anomaly < 0;
          const missing = y.value === null || !Number.isFinite(y.value);
          return (
            <div
              key={y.year}
              className={`flex-1 min-w-[2px] rounded-t ${
                missing
                  ? 'bg-foreground/[0.08]'
                  : below
                    ? 'bg-amber-500/70'
                    : 'bg-sky-500/70'
              }`}
              style={{ height: `${Math.min(100, heightPct(y.value))}%` }}
              title={
                `${y.year}: ${fmt(y.value, 3)} ${unit} · anomaly ${fmtSigned(y.anomaly, 3)} ${unit}` +
                ` (${fmtSigned(y.anomaly_percent, 1)}%) · ${y.valid_days} valid days`
              }
            />
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] font-mono text-foreground/40">
        <span>{first ?? '—'}</span>
        <span>{last ?? '—'}</span>
      </div>
      <p className="text-[10px] text-foreground/35 leading-snug">
        Amber bars sit below the record mean, sky bars above it; the sign is repeated in each
        bar&apos;s tooltip so colour is never the only signal. Hover a bar for its value, anomaly,
        and how many valid days the season contributed.
      </p>
    </div>
  );
}

// ── Small presentational pieces ───────────────────────────────────────────────

function Stat({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
}) {
  return (
    <div className="rounded-lg bg-foreground/[0.04] border border-foreground/12 p-2 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-foreground/45">{label}</span>
      <span className="text-sm font-bold font-mono leading-tight text-foreground">
        {value}
        {unit && <span className="text-[10px] text-foreground/45 font-normal ml-1">{unit}</span>}
      </span>
      <span className="text-[10px] text-foreground/35 leading-tight">{note}</span>
    </div>
  );
}

function ExtremeCard({
  caption,
  arrow,
  year,
  value,
  mean,
  unit,
  tone,
}: {
  caption: string;
  arrow: string;
  year: number | null;
  value: number | null;
  mean: number | null;
  unit: string;
  tone: 'amber' | 'sky';
}) {
  const color = tone === 'amber' ? 'text-amber-300' : 'text-sky-300';
  const border = tone === 'amber' ? 'border-amber-500/25' : 'border-sky-500/25';
  const anomaly =
    value !== null && mean !== null && Number.isFinite(value) && Number.isFinite(mean)
      ? value - mean
      : null;

  return (
    <div className={`rounded-lg bg-foreground/[0.04] border ${border} p-3 flex flex-col gap-1`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-foreground/50">{caption}</span>
        <span className={`text-xs ${color}`} aria-hidden="true">
          {arrow}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold font-mono text-foreground leading-none">
          {year === null ? '—' : year}
        </span>
        <span className={`text-sm font-mono ${color}`}>
          {fmt(value, 3)}
          <span className="text-[10px] text-foreground/45 ml-1">{unit}</span>
        </span>
      </div>
      <span className="text-[10px] text-foreground/40">
        {anomaly === null ? 'anomaly —' : `${fmtSigned(anomaly, 3)} ${unit} vs the record mean`}
      </span>
    </div>
  );
}
