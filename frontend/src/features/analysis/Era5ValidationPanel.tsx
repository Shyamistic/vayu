/**
 * ERA5 independent-reference validation panel.
 *
 * Every other analysis surface in this app reads the same normalized bundle: the
 * sensitivity fit, the climatology, the What-If baseline. That means a fault in
 * the regridding or in the per-cell denormalization would be invisible to all of
 * them *coherently* — they would agree with each other and all be wrong.
 *
 * ERA5 is produced by ECMWF from a different observing system, a different
 * assimilation scheme and a different model, so this is the one panel whose
 * reference sits outside our pipeline. It answers "is our data right", where the
 * rest answer "what does our data say".
 *
 * Server-computed only. There is no offline estimate and there must not be: a
 * fabricated reference series turns a validation into a rubber stamp.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';

import { fetchEra5Comparison } from '../../api/client';
import type { Era5AgreementStats, Era5ComparisonResponse } from '../../types';
import { fmt, fmtPValue, fmtSigned, regionLabel } from './whatIfFormat';

const Era5ValidationChart = lazy(() => import('./Era5ValidationChart'));

type Era5Variable = 'rainfall' | 'tmax' | 'tmin';

const VARIABLES: { id: Era5Variable; label: string; short: string }[] = [
  { id: 'rainfall', label: 'Rainfall', short: 'rain' },
  { id: 'tmax', label: 'Max temperature', short: 'tmax' },
  { id: 'tmin', label: 'Min temperature', short: 'tmin' },
];

/**
 * Windows chosen to be defensible rather than convenient. Each is a whole
 * number of monsoons so the monthly comparison is not dominated by half a
 * season, and each ends well inside the archive's ~5-day lag.
 */
const RANGES: { id: string; label: string; start: string; end: string }[] = [
  { id: '2024-jjas', label: 'Monsoon 2024', start: '2024-06-01', end: '2024-09-30' },
  { id: '2024', label: 'Calendar 2024', start: '2024-01-01', end: '2024-12-31' },
  { id: '2023-2024', label: '2023–2024', start: '2023-01-01', end: '2024-12-31' },
  { id: '2023-jjas', label: 'Monsoon 2023', start: '2023-06-01', end: '2023-09-30' },
];

export interface Era5ValidationPanelProps {
  region: string;
  /** Defaults to rainfall: it is the target variable and the harder test. */
  variable?: Era5Variable;
  autoLoad?: boolean;
}

export default function Era5ValidationPanel({
  region,
  variable: initialVariable = 'rainfall',
  autoLoad = false,
}: Era5ValidationPanelProps) {
  const [variable, setVariable] = useState<Era5Variable>(initialVariable);
  const [rangeId, setRangeId] = useState(RANGES[0].id);
  const [data, setData] = useState<Era5ComparisonResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () => RANGES.find((r) => r.id === rangeId) ?? RANGES[0],
    [rangeId],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchEra5Comparison({
        region,
        variable,
        startDate: range.start,
        endDate: range.end,
      });
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — nothing is substituted, because a stand-in reference series would make this validation meaningless.`
          : 'ERA5 comparison unavailable — nothing is substituted, because a stand-in reference series would make this validation meaningless.',
      );
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [region, variable, range]);

  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  return (
    <section aria-labelledby="era5-validation-heading" className="panel p-4 flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-[16rem]">
          <h2
            id="era5-validation-heading"
            className="text-foreground font-semibold text-base tracking-wide flex items-center gap-2"
          >
            <ShieldCheck size={16} className="text-emerald-400" />
            ERA5 cross-check — is our data right?
          </h2>
          <p className="text-xs text-foreground/50 leading-snug">
            {regionLabel(region)} &middot; our denormalized IMD bundle scored against ECMWF
            ERA5 reanalysis over the same days. An independent reference, not one of our own
            inputs for this variable.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-foreground/60">
            <span className="sr-only">Variable to validate</span>
            <select
              value={variable}
              onChange={(e) => setVariable(e.target.value as Era5Variable)}
              className="input text-xs py-1"
              aria-label="Variable to validate against ERA5"
            >
              {VARIABLES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-foreground/60">
            <span className="sr-only">Date range</span>
            <select
              value={rangeId}
              onChange={(e) => setRangeId(e.target.value)}
              className="input text-xs py-1"
              aria-label="Date range to compare"
            >
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void load()}
            disabled={isLoading}
            aria-label={data ? 'Refresh ERA5 comparison' : 'Run ERA5 comparison'}
            className="btn-ghost flex items-center gap-1.5 text-xs shrink-0"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : undefined} />
            {isLoading ? 'Comparing…' : data ? 'Refresh' : 'Run check'}
          </button>
        </div>
      </header>

      {error && (
        <div className="flex gap-2 p-3 bg-red-500/15 border border-red-500/30 rounded-lg">
          <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-200 leading-snug">{error}</p>
        </div>
      )}

      {!data && !error && !isLoading && (
        <p className="text-xs text-foreground/40">
          Run the check to score our bundle against ERA5 for {range.label.toLowerCase()}. The
          archive call is live, so this needs network access.
        </p>
      )}

      {data && <Era5ValidationBody data={data} />}
    </section>
  );
}

// ── Result body ───────────────────────────────────────────────────────────────

function Era5ValidationBody({ data }: { data: Era5ComparisonResponse }) {
  const isRain = data.variable === 'rainfall';
  const daily = data.daily_stats;
  const monthly = data.monthly.stats;
  const cell = data.our_grid_cell;

  // For rainfall the monthly figure is the headline: the daily correlation is
  // depressed by the 0830-0830 IST rain-day convention, which shifts rain
  // between adjacent days without touching a monthly total.
  const headline = isRain && monthly ? monthly : daily;
  const headlineScope = isRain && monthly ? 'monthly' : 'daily';
  // A summed mm/day series is mm, so the monthly block cannot reuse data.unit —
  // labelling a monthly rainfall bias of −6.6 mm as "mm/day" understates it 30×.
  const monthlyUnit = data.monthly.unit ?? data.unit;
  const headlineUnit = headlineScope === 'monthly' ? monthlyUnit : data.unit;

  return (
    <div className="flex flex-col gap-4">
      {!cell.denormalized && (
        <div className="flex gap-2 p-3 bg-red-500/15 border border-red-500/30 rounded-lg">
          <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-200 leading-snug">
            Per-cell normalisation parameters were unavailable, so our series is still in
            z-score units. Every statistic below is meaningless until that is fixed.
          </p>
        </div>
      )}

      {/* ── Headline agreement ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat
          label={`Bias (${headlineScope})`}
          value={fmtSigned(headline.bias, 3)}
          unit={headlineUnit}
          note="ERA5 minus ours; positive means ERA5 reads higher"
          tone={
            headline.bias === null
              ? undefined
              : Math.abs(headline.bias) < Math.abs(headline.observed_mean ?? 1) * 0.1
                ? 'good'
                : 'warn'
          }
        />
        <Stat
          label={`RMSE (${headlineScope})`}
          value={fmt(headline.rmse, 3)}
          unit={headlineUnit}
          note="root mean squared difference"
        />
        <Stat
          label={`MAE (${headlineScope})`}
          value={fmt(headline.mae, 3)}
          unit={headlineUnit}
          note="mean absolute difference"
        />
        <Stat
          label={`Correlation (${headlineScope})`}
          value={fmt(headline.pearson_r, 3)}
          unit="r"
          note={`${fmtPValue(headline.pearson_p)} · n = ${headline.n}`}
          tone={
            headline.pearson_r === null
              ? undefined
              : headline.pearson_r > 0.8
                ? 'good'
                : headline.pearson_r > 0.5
                  ? undefined
                  : 'warn'
          }
        />
      </div>

      {isRain && daily.total_ratio !== null && daily.total_ratio !== undefined && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Stat
            label="Our period total"
            value={fmt(daily.observed_total, 1)}
            unit="mm"
            note="summed over paired days only"
          />
          <Stat
            label="ERA5 period total"
            value={fmt(daily.reference_total, 1)}
            unit="mm"
            note="same days, same count"
          />
          <Stat
            label="Total ratio"
            value={fmt(daily.total_ratio, 3)}
            unit="ERA5 ÷ ours"
            note="1.00 is exact agreement on accumulation"
            tone={
              Math.abs((daily.total_ratio ?? 1) - 1) < 0.15 ? 'good' : 'warn'
            }
          />
        </div>
      )}

      {/* ── Daily vs monthly, side by side ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <StatsCard title="Daily pairs" stats={daily} unit={data.unit} />
        <StatsCard
          title={`Monthly ${data.monthly.aggregation === 'sum' ? 'totals' : 'means'}`}
          stats={monthly}
          unit={monthlyUnit}
          emptyNote="Not enough complete months in this window to aggregate."
        />
      </div>

      {isRain && monthly && daily.pearson_r !== null && monthly.pearson_r !== null && (
        <p className="text-xs text-foreground/55 leading-relaxed">
          Daily r is <span className="font-mono">{fmt(daily.pearson_r, 2)}</span> and monthly r
          is <span className="font-mono">{fmt(monthly.pearson_r, 2)}</span>.{' '}
          {monthly.pearson_r - daily.pearson_r > 0.1
            ? 'The monthly figure being the stronger of the two is what the day-boundary mismatch predicts: IMD accumulates 0830–0830 IST, the archive 0000–2400, so rain moves between adjacent days but stays inside the month.'
            : 'The two are close, so the day-boundary convention is not doing much work here.'}
        </p>
      )}

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      {data.daily && data.daily.dates.length > 1 && (
        <Suspense
          fallback={
            <div className="h-64 flex items-center justify-center text-xs text-foreground/40">
              Loading charts…
            </div>
          }
        >
          <Era5ValidationChart
            labels={data.daily.dates}
            observed={data.daily.observed}
            reference={data.daily.reference}
            unit={data.unit}
            valueLabel={isRain ? 'Daily rainfall' : 'Temperature'}
            mode="lines"
          />
        </Suspense>
      )}

      {data.monthly.labels.length > 1 && (
        <Suspense fallback={null}>
          <Era5ValidationChart
            labels={data.monthly.labels}
            observed={data.monthly.observed}
            reference={data.monthly.reference}
            unit={monthlyUnit}
            valueLabel={
              data.monthly.aggregation === 'sum' ? 'Monthly total' : 'Monthly mean'
            }
            mode="bars"
            height={240}
          />
        </Suspense>
      )}

      {/* ── Provenance ───────────────────────────────────────────────────── */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Meta term="Window" value={`${data.start_date} → ${data.end_date}`} />
        <Meta
          term="Sampled at"
          value={`${fmt(cell.cell_lat, 3)} N, ${fmt(cell.cell_lon, 3)} E`}
        />
        <Meta
          term="Offset from request"
          value={`${fmt(cell.distance_from_request_km, 1)} km`}
        />
        <Meta
          term="Reference point"
          value={data.reference_point?.label ?? 'custom'}
        />
      </dl>

      {data.caveats.length > 0 && (
        <div
          aria-labelledby="era5-caveat-heading"
          className="flex flex-col gap-2 p-3 caveat-box"
        >
          <h3
            id="era5-caveat-heading"
            className="text-xs font-semibold caveat-heading tracking-wide uppercase flex items-center gap-1.5"
          >
            <AlertTriangle size={13} />
            What this comparison can and cannot show
          </h3>
          <ul className="flex flex-col gap-1.5 list-disc pl-4">
            {data.caveats.map((c) => (
              <li key={c} className="text-xs caveat-text leading-relaxed">
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

function StatsCard({
  title,
  stats,
  unit,
  emptyNote,
}: {
  title: string;
  stats: Era5AgreementStats | null;
  unit: string;
  emptyNote?: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/12 bg-foreground/[0.04] p-3 flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-foreground/65">
        {title}
      </span>
      {stats ? (
        <dl className="flex flex-col gap-1 text-xs">
          <Row term="pairs" value={`n = ${stats.n}`} />
          <Row term="our mean" value={`${fmt(stats.observed_mean, 3)} ${unit}`} />
          <Row term="ERA5 mean" value={`${fmt(stats.reference_mean, 3)} ${unit}`} />
          <Row term="bias" value={`${fmtSigned(stats.bias, 3)} ${unit}`} />
          <Row term="MAE" value={`${fmt(stats.mae, 3)} ${unit}`} />
          <Row term="RMSE" value={`${fmt(stats.rmse, 3)} ${unit}`} />
          <Row term="Pearson r" value={fmt(stats.pearson_r, 3)} />
          <Row term="r²" value={fmt(stats.r_squared, 3)} />
          <Row term="significance" value={fmtPValue(stats.pearson_p)} />
        </dl>
      ) : (
        <p className="text-xs text-foreground/40 leading-snug">
          {emptyNote ?? 'Not available for this window.'}
        </p>
      )}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-foreground/50">{term}</dt>
      <dd className="font-mono text-foreground/85">{value}</dd>
    </div>
  );
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wider text-foreground/45">{term}</dt>
      <dd className="font-mono text-foreground/80 text-xs">{value}</dd>
    </div>
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
  tone?: 'good' | 'warn';
}) {
  const color =
    tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-foreground';
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
