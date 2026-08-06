/**
 * Older vs newer baseline panel.
 *
 * Fits the sensitivity independently either side of a split year and reports
 * whether the two halves of the record actually differ. The verdict is driven
 * strictly by `difference.slope_changed_significantly`: when the test does not
 * clear the threshold the copy says the record does not demonstrate a change,
 * because "the newer half looks steeper" is exactly the kind of eyeballed claim
 * this endpoint exists to discipline.
 *
 * Server-computed only — no offline estimate, since a fabricated epoch fit would
 * read as evidence of a shifting baseline.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, GitCompareArrows, RefreshCw } from 'lucide-react';

import { fetchBaselineComparison } from '../../api/client';
import type {
  BaselineComparisonResponse,
  BaselineEpochFit,
  PredictorId,
  SeasonId,
} from '../../types';
import {
  confidenceLevel,
  CONFIDENCE_COPY,
  fmt,
  fmtCI,
  fmtPValue,
  fmtSigned,
  predictorById,
  regionLabel,
  SEASONS,
} from './whatIfFormat';

export interface BaselineSplitPanelProps {
  region: string;
  predictor: PredictorId;
  season: SeasonId;
  /** First year of the newer epoch. Omitted lets the backend halve the record. */
  splitYear?: number;
  autoLoad?: boolean;
}

function seasonLabel(season: SeasonId): string {
  return SEASONS.find((s) => s.id === season)?.label ?? season;
}

export default function BaselineSplitPanel({
  region,
  predictor,
  season,
  splitYear,
  autoLoad = false,
}: BaselineSplitPanelProps) {
  const [data, setData] = useState<BaselineComparisonResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchBaselineComparison({ region, predictor, season, splitYear });
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — no offline estimate is shown because both epoch fits come from the observed record.`
          : 'Baseline comparison unavailable — no offline estimate is shown because both epoch fits come from the observed record.',
      );
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [region, predictor, season, splitYear]);

  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  const driver = predictorById(predictor);

  return (
    <section aria-labelledby="baseline-split-heading" className="panel p-4 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="baseline-split-heading"
            className="text-foreground font-semibold text-base tracking-wide flex items-center gap-2"
          >
            <GitCompareArrows size={16} className="text-sky-400" />
            Older vs newer baseline
          </h2>
          <p className="text-xs text-foreground/50 leading-snug">
            {regionLabel(region)} &middot; {data?.season_label ?? seasonLabel(season)} &middot; the
            same {driver.label.toLowerCase()} sensitivity fitted separately either side of
            {data ? ` ${data.split_year}` : splitYear ? ` ${splitYear}` : ' the record midpoint'}.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={isLoading}
          aria-label={data ? 'Refresh baseline comparison' : 'Load baseline comparison'}
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
          Load the observed record to compare the two halves and see whether the difference is
          testable.
        </p>
      )}

      {data && <BaselineSplitBody data={data} />}
    </section>
  );
}

// ── Result body ───────────────────────────────────────────────────────────────

function BaselineSplitBody({ data }: { data: BaselineComparisonResponse }) {
  const { older, newer, difference, caveats } = data;
  const changed = difference.slope_changed_significantly;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
        <EpochCard epoch={older} />

        {/* ── Difference column ─────────────────────────────────────────────── */}
        <div
          className={`flex flex-col gap-1.5 rounded-lg border p-3 md:w-52 ${
            changed
              ? 'border-emerald-400/40 bg-emerald-400/[0.08]'
              : 'border-foreground/12 bg-foreground/[0.04]'
          }`}
        >
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">
            Difference (newer − older)
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-foreground leading-none">
              {fmtSigned(difference.slope_delta, 4)}
            </span>
          </div>
          <span className="text-[10px] text-foreground/45">{difference.slope_unit}</span>

          <dl className="flex flex-col gap-1 mt-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-foreground/50">95 % CI</dt>
              <dd className="font-mono text-foreground/85">
                {fmtCI(difference.slope_delta_ci95_low, difference.slope_delta_ci95_high, 4)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-foreground/50">significance</dt>
              <dd className="font-mono text-foreground/85">
                {fmtPValue(difference.slope_delta_p_value)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-foreground/50">std. error</dt>
              <dd className="font-mono text-foreground/85">{fmt(difference.slope_delta_se, 4)}</dd>
            </div>
          </dl>

          <VerdictBadge changed={changed} />
          <p className="text-xs text-foreground/65 leading-relaxed">
            {changed
              ? 'The two halves of the record have significantly different slopes, so a single ∂R/∂T fitted over the whole period averages two different regimes.'
              : 'The record does not demonstrate a change in slope: the difference above is within its own uncertainty, so treat the two halves as one sensitivity rather than reading a shift into them.'}
          </p>
        </div>

        <EpochCard epoch={newer} />
      </div>

      {/* ── Mean shift ─────────────────────────────────────────────────────── */}
      <div
        className="grid grid-cols-1 sm:grid-cols-3 gap-2"
        aria-labelledby="baseline-split-means-heading"
      >
        <h3 id="baseline-split-means-heading" className="sr-only">
          Mean shift between epochs
        </h3>
        <Stat
          label={`Δ mean ${newer.fit.response}`}
          value={fmtSigned(difference.response_mean_delta, 3)}
          unit={newer.fit.response_unit}
          note={`newer minus older${
            (difference.response_mean_delta ?? 0) < 0 ? ' (↓ lower)' : (difference.response_mean_delta ?? 0) > 0 ? ' (↑ higher)' : ''
          }`}
          tone={
            difference.response_mean_delta === null
              ? undefined
              : difference.response_mean_delta < 0
                ? 'warn'
                : 'cool'
          }
        />
        <Stat
          label="Δ mean as percent"
          value={`${fmtSigned(difference.response_mean_delta_percent, 1)}%`}
          unit=""
          note="relative to the older epoch mean"
        />
        <Stat
          label={`Δ mean ${newer.fit.predictor}`}
          value={fmtSigned(difference.predictor_mean_delta, 3)}
          unit={newer.fit.predictor_unit}
          note="how much the driver itself shifted"
        />
      </div>

      {difference.definition && (
        <p className="text-[10px] text-foreground/35 leading-snug">{difference.definition}</p>
      )}

      {caveats.length > 0 && (
        <div
          aria-labelledby="baseline-split-caveat-heading"
          className="flex flex-col gap-2 p-3 bg-amber-500/[0.07] border border-amber-500/25 rounded-lg"
        >
          <h3
            id="baseline-split-caveat-heading"
            className="text-xs font-semibold text-amber-200 tracking-wide uppercase flex items-center gap-1.5"
          >
            <AlertTriangle size={13} />
            What this split cannot tell you
          </h3>
          <ul className="flex flex-col gap-1.5 list-disc pl-4">
            {caveats.map((c) => (
              <li key={c} className="text-xs text-amber-100/85 leading-relaxed">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EpochCard({ epoch }: { epoch: BaselineEpochFit }) {
  const level = confidenceLevel(epoch.fit);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-foreground/12 bg-foreground/[0.04] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground/65">
          {epoch.label}
        </span>
        <span className="text-[10px] font-mono text-foreground/45">
          {epoch.year_start}&ndash;{epoch.year_end}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold font-mono text-foreground leading-none">
          {fmt(epoch.fit.slope, 4)}
        </span>
        <span className="text-[10px] text-foreground/50">{epoch.fit.slope_unit}</span>
      </div>

      <dl className="flex flex-col gap-1 text-xs">
        <Row term="r²" value={fmt(epoch.fit.r_squared, 3)} />
        <Row
          term="significance"
          value={fmtPValue(epoch.fit.p_value)}
          tone={epoch.fit.significant ? 'good' : 'warn'}
        />
        <Row term="seasons" value={`n = ${epoch.n_years}`} />
        <Row
          term={`mean ${epoch.fit.response}`}
          value={`${fmt(epoch.response_mean, 3)} ${epoch.fit.response_unit}`}
        />
        <Row
          term={`mean ${epoch.fit.predictor}`}
          value={`${fmt(epoch.predictor_mean, 3)} ${epoch.fit.predictor_unit}`}
        />
      </dl>

      <p className="text-[10px] text-foreground/40 leading-snug">
        {CONFIDENCE_COPY[level].label}. {CONFIDENCE_COPY[level].detail}
      </p>
    </div>
  );
}

function Row({
  term,
  value,
  tone,
}: {
  term: string;
  value: string;
  tone?: 'good' | 'warn';
}) {
  const color =
    tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-foreground/85';
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-foreground/50">{term}</dt>
      <dd className={`font-mono ${color}`}>{value}</dd>
    </div>
  );
}

function VerdictBadge({ changed }: { changed: boolean }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border text-center ${
        changed
          ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200'
          : 'border-foreground/25 bg-foreground/[0.06] text-foreground/70'
      }`}
    >
      {changed ? '✓ Slope changed (p < 0.05)' : '✗ Not a demonstrated change'}
    </span>
  );
}

function Stat({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
  tone?: 'warn' | 'cool';
}) {
  const color =
    tone === 'warn' ? 'text-amber-300' : tone === 'cool' ? 'text-sky-300' : 'text-foreground';
  return (
    <div className="rounded-lg bg-foreground/[0.04] border border-foreground/12 p-2 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-foreground/45">{label}</span>
      <span className={`text-sm font-bold font-mono leading-tight ${color}`}>
        {value}
        {unit && <span className="text-[10px] text-foreground/45 font-normal ml-1">{unit}</span>}
      </span>
      <span className="text-[10px] text-foreground/35 leading-tight">{note}</span>
    </div>
  );
}
