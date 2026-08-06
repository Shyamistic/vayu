/**
 * What-If Studio — the observation-driven scenario dashboard.
 *
 * Replaces the previous What-If panel, which applied literature constants
 * (a fixed +7 %/°C Clausius-Clapeyron coefficient) to a synthetic base field and
 * reported the output as a result. Everything here comes from a regression over
 * the observed 1981-2025 record: the sensitivity, its confidence interval, the
 * baseline, and the past/current epochs. The projected value is the only
 * extrapolated number on screen and is labelled as such throughout.
 *
 * Layout follows the review notes: driver and calendar-range controls, the
 * ∂R/∂T regression with its metrics and error visualisation, an explicit
 * before/after split, a past/current/future timeline, spatial analytics, and
 * JSON/PDF/CSV download of everything shown.
 */

import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  Download,
  FileJson,
  FileSpreadsheet,
  Info,
  Play,
  Printer,
  RotateCcw,
  Sigma,
} from 'lucide-react';

import { runWhatIf } from '../../api/client';
import type { PredictorId, SeasonId, WhatIfRequest, WhatIfResponse } from '../../types';
import WhatIfBeforeAfter from './WhatIfBeforeAfter';
import {
  downloadWhatIfCsv,
  downloadWhatIfJson,
  printWhatIfReport,
  type WhatIfExportMeta,
} from './whatIfExport';
import {
  compareToClausiusClapeyron,
  confidenceLevel,
  CONFIDENCE_COPY,
  describeSensitivity,
  fmt,
  fmtCI,
  fmtPValue,
  fmtSigned,
  PREDICTORS,
  predictorById,
  REGION_LABELS,
  regionLabel,
  SEASONS,
} from './whatIfFormat';

const WhatIfRegressionChart = lazy(() => import('./WhatIfRegressionChart'));

/** Regions with a built normalized bundle. full_india omitted: the 0.5° grid
 *  bundle is not part of the 1981 rebuild the sensitivity fit reads. */
const REGIONS = [
  'western_ghats',
  'north_east_india',
  'indo_gangetic_plain',
  'central_india',
] as const;

const RECORD_FIRST_YEAR = 1981;
const RECORD_LAST_YEAR = 2025;

export interface WhatIfStudioProps {
  /** Region currently selected elsewhere in the app, used as the initial value. */
  initialRegion?: string;
  /** Notifies the host when a projection completes, e.g. to drive the split globe. */
  onResult?: (result: WhatIfResponse) => void;
  onReset?: () => void;
}

type RangeMode = 'season' | 'custom';

export default function WhatIfStudio({
  initialRegion,
  onResult,
  onReset,
}: WhatIfStudioProps) {
  const [region, setRegion] = useState<string>(
    initialRegion && (REGIONS as readonly string[]).includes(initialRegion)
      ? initialRegion
      : 'indo_gangetic_plain',
  );
  const [predictor, setPredictor] = useState<PredictorId>('tmax');
  const [season, setSeason] = useState<SeasonId>('jjas');
  const [rangeMode, setRangeMode] = useState<RangeMode>('season');
  const [windowStart, setWindowStart] = useState('06-01');
  const [windowEnd, setWindowEnd] = useState('09-30');
  const [startYear, setStartYear] = useState(RECORD_FIRST_YEAR);
  const [endYear, setEndYear] = useState(RECORD_LAST_YEAR);
  const [delta, setDelta] = useState(predictorById('tmax').defaultDelta);

  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const driver = predictorById(predictor);

  const exportMeta: WhatIfExportMeta = useMemo(
    () => ({
      region,
      predictor,
      season,
      delta,
      windowStart: rangeMode === 'custom' ? windowStart : undefined,
      windowEnd: rangeMode === 'custom' ? windowEnd : undefined,
      startYear,
      endYear,
    }),
    [region, predictor, season, delta, rangeMode, windowStart, windowEnd, startYear, endYear],
  );

  const handlePredictorChange = useCallback((id: PredictorId) => {
    setPredictor(id);
    setDelta(predictorById(id).defaultDelta);
    setResult(null);
    setError(null);
  }, []);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3000);
  }, []);

  const handleRun = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const request: WhatIfRequest = {
      region,
      predictor,
      response: 'rainfall',
      delta,
      season,
      start_year: startYear,
      end_year: endYear,
      include_cells: true,
      ...(rangeMode === 'custom'
        ? { window_start: windowStart, window_end: windowEnd }
        : {}),
    };

    try {
      const res = await runWhatIf(request);
      setResult(res);
      onResult?.(res);
    } catch (err) {
      // No demo fallback on purpose: fabricated regression diagnostics would
      // read as measurements. Say the analysis is unavailable instead.
      setError(
        err instanceof Error
          ? `${err.message} — the sensitivity fit needs the observed record, so no offline estimate is shown.`
          : 'Analysis failed',
      );
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [
    region, predictor, delta, season, startYear, endYear,
    rangeMode, windowStart, windowEnd, onResult,
  ]);

  const handleReset = useCallback(() => {
    setResult(null);
    setError(null);
    onReset?.();
  }, [onReset]);

  const handlePrint = useCallback(() => {
    if (!result) return;
    const opened = printWhatIfReport(result, exportMeta);
    flash(
      opened
        ? 'Report opened — choose "Save as PDF" in the print dialog'
        : 'Pop-up blocked. Allow pop-ups for this site to export the PDF.',
    );
  }, [result, exportMeta, flash]);

  const level = result ? confidenceLevel(result.fit) : null;
  const ccNote = result ? compareToClausiusClapeyron(result.fit) : null;

  return (
    <div className="panel p-4 flex flex-col gap-5 w-full">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-white font-semibold text-base tracking-wide flex items-center gap-2">
            <Sigma size={17} className="text-amber-400" />
            What-If Studio
          </h2>
          <p className="text-xs text-white/50 max-w-md leading-snug">
            Sensitivity regressed from the observed 1981&ndash;2025 record, then applied to a
            driver change you choose. Every figure below traces to measurements.
          </p>
        </div>
        {result && (
          <button onClick={handleReset} className="btn-ghost flex items-center gap-1.5 text-xs shrink-0">
            <RotateCcw size={12} />
            Reset
          </button>
        )}
      </header>

      {/* ── Controls ────────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4" aria-label="Analysis configuration">
        <Field label="Region">
          <div className="grid grid-cols-2 gap-1.5">
            {REGIONS.map((r) => (
              <Choice key={r} active={region === r} onClick={() => { setRegion(r); setResult(null); }}>
                {REGION_LABELS[r]}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="Driver (the T in ∂R/∂T)" hint={driver.description}>
          <div className="grid grid-cols-2 gap-1.5">
            {PREDICTORS.map((p) => (
              <Choice
                key={p.id}
                active={predictor === p.id}
                onClick={() => handlePredictorChange(p.id)}
              >
                {p.label}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="Calendar range">
          <div className="flex gap-1.5 mb-2">
            <Choice active={rangeMode === 'season'} onClick={() => setRangeMode('season')}>
              Named season
            </Choice>
            <Choice active={rangeMode === 'custom'} onClick={() => setRangeMode('custom')}>
              <span className="flex items-center gap-1">
                <CalendarRange size={12} /> Custom dates
              </span>
            </Choice>
          </div>

          {rangeMode === 'season' ? (
            <div className="grid grid-cols-2 gap-1.5">
              {SEASONS.map((s) => (
                <Choice
                  key={s.id}
                  active={season === s.id}
                  onClick={() => { setSeason(s.id); setResult(null); }}
                >
                  {s.label}
                </Choice>
              ))}
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-[10px] uppercase tracking-wider text-white/45">From (MM-DD)</span>
                <input
                  type="text"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  placeholder="06-01"
                  pattern="\d{2}-\d{2}"
                  className="bg-white/[0.06] border border-white/15 rounded-md px-2 py-1.5 text-sm
                             text-white font-mono focus:border-amber-400/60 focus:outline-none"
                />
              </label>
              <span className="text-white/40 pb-2">&rarr;</span>
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-[10px] uppercase tracking-wider text-white/45">To (MM-DD)</span>
                <input
                  type="text"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  placeholder="09-30"
                  pattern="\d{2}-\d{2}"
                  className="bg-white/[0.06] border border-white/15 rounded-md px-2 py-1.5 text-sm
                             text-white font-mono focus:border-amber-400/60 focus:outline-none"
                />
              </label>
            </div>
          )}
          <p className="text-[10px] text-white/40 mt-1.5">
            The historical mean rainfall reported as the baseline is computed over exactly this
            range, repeated every year of the record.
          </p>
        </Field>

        <Field label="Years included in the fit">
          <div className="flex items-center gap-2">
            <NumberInput
              value={startYear}
              min={RECORD_FIRST_YEAR}
              max={endYear - 2}
              onChange={setStartYear}
              ariaLabel="First year"
            />
            <span className="text-white/40">&ndash;</span>
            <NumberInput
              value={endYear}
              min={startYear + 2}
              max={RECORD_LAST_YEAR}
              onChange={setEndYear}
              ariaLabel="Last year"
            />
            <span className="text-xs text-white/45 ml-1">{endYear - startYear + 1} seasons</span>
          </div>
        </Field>

        <Field label={`Driver change (Δ${driver.label})`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={driver.min}
              max={driver.max}
              step={driver.step}
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
              aria-label={`Change in ${driver.label}`}
              className="flex-1 h-1.5 appearance-none bg-white/12 rounded-full cursor-pointer
                         [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <span className="text-lg font-bold font-mono text-amber-400 w-20 text-right tabular-nums">
              {fmtSigned(delta, 2)}
              <span className="text-xs text-white/45 ml-0.5">{driver.unit}</span>
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-white/30 mt-1">
            <span>{driver.min}{driver.unit}</span>
            <span>{driver.max}{driver.unit}</span>
          </div>
        </Field>

        <button
          onClick={handleRun}
          disabled={isLoading}
          className="btn-primary flex items-center justify-center gap-2 py-2.5"
        >
          {isLoading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Fitting sensitivity over {endYear - startYear + 1} seasons…
            </>
          ) : (
            <>
              <Play size={14} />
              Run before / after analysis
            </>
          )}
        </button>
      </section>

      {error && (
        <div className="flex gap-2 p-3 bg-red-500/15 border border-red-500/30 rounded-lg">
          <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-200 leading-snug">{error}</p>
        </div>
      )}

      {notice && (
        <div className="flex gap-2 p-2.5 bg-sky-500/15 border border-sky-500/30 rounded-lg">
          <Info size={14} className="text-sky-300 mt-0.5 shrink-0" />
          <p className="text-xs text-sky-100">{notice}</p>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {result && level && (
        <>
          <hr className="border-white/10" />

          {/* Sensitivity headline */}
          <section aria-labelledby="whatif-sens-heading" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3
                id="whatif-sens-heading"
                className="text-sm font-semibold text-white/90 tracking-wide uppercase"
              >
                Observed sensitivity ∂R/∂T
              </h3>
              <ConfidenceBadge level={level} />
            </div>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-bold font-mono text-amber-400 leading-none">
                {fmt(result.fit.slope, 3)}
              </span>
              <span className="text-xs text-white/55">{result.fit.slope_unit}</span>
              <span className="text-base font-semibold text-white/80 ml-1">
                ({fmtSigned(result.fit.slope_percent_per_unit, 1)}% per {result.fit.predictor_unit})
              </span>
            </div>

            <p className="text-xs text-white/70 leading-relaxed">
              {describeSensitivity(result.fit, result.region)}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="r²" value={fmt(result.fit.r_squared, 3)} note="variance explained" />
              <Stat
                label="significance"
                value={fmtPValue(result.fit.p_value)}
                note="two-sided t-test"
                tone={result.fit.significant ? 'good' : 'warn'}
              />
              <Stat
                label="95% CI on slope"
                value={fmtCI(result.fit.ci95_low, result.fit.ci95_high, 3)}
                note={`± ${fmt(result.fit.std_err, 3)} std. error`}
              />
              <Stat label="sample" value={`n = ${result.fit.n}`} note="seasons in the fit" />
            </div>

            <p className="text-xs text-white/45">
              {CONFIDENCE_COPY[level].detail}
              {result.excluded_years.length > 0 && (
                <>
                  {' '}Excluded for incomplete coverage:{' '}
                  <span className="font-mono">{result.excluded_years.join(', ')}</span>.
                </>
              )}
            </p>

            {ccNote && (
              <div className="flex gap-2 p-2.5 bg-white/[0.04] border border-white/10 rounded-lg">
                <Info size={13} className="text-amber-400/80 mt-0.5 shrink-0" />
                <p className="text-xs text-white/65 leading-relaxed">{ccNote}</p>
              </div>
            )}
          </section>

          {/* Regression chart */}
          <section aria-labelledby="whatif-chart-heading" className="flex flex-col gap-2">
            <h3
              id="whatif-chart-heading"
              className="text-sm font-semibold text-white/90 tracking-wide uppercase flex items-center gap-2"
            >
              <BarChart3 size={14} className="text-white/50" />
              Fit and error
            </h3>
            <Suspense
              fallback={<div className="h-64 flex items-center justify-center text-xs text-white/40">Loading chart…</div>}
            >
              <WhatIfRegressionChart
                points={result.scatter}
                fit={result.fit}
                appliedDelta={delta}
              />
            </Suspense>
          </section>

          <hr className="border-white/10" />

          {/* Before / after + timeline + spatial */}
          <WhatIfBeforeAfter result={result} />

          {/* Hotspots */}
          {result.hotspots.length > 0 && (
            <section aria-labelledby="whatif-hot-heading" className="flex flex-col gap-2">
              <h3
                id="whatif-hot-heading"
                className="text-sm font-semibold text-white/90 tracking-wide uppercase"
              >
                Strongest local responses
              </h3>
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-xs">
                  <thead className="bg-white/[0.06] text-white/60">
                    <tr>
                      <th scope="col" className="text-left py-1.5 px-2 font-medium">Lat</th>
                      <th scope="col" className="text-left py-1.5 px-2 font-medium">Lon</th>
                      <th scope="col" className="text-right py-1.5 px-2 font-medium">
                        Δ {result.regional.unit}
                      </th>
                      <th scope="col" className="text-right py-1.5 px-2 font-medium">Δ %</th>
                      <th scope="col" className="text-left py-1.5 px-2 font-medium">p&lt;0.05</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.hotspots.slice(0, 10).map((h) => (
                      <tr key={h.node_idx} className="border-t border-white/[0.06]">
                        <td className="py-1.5 px-2 font-mono text-white/75">{fmt(h.lat, 2)}</td>
                        <td className="py-1.5 px-2 font-mono text-white/75">{fmt(h.lon, 2)}</td>
                        <td
                          className={`py-1.5 px-2 font-mono text-right ${
                            (h.delta_value ?? 0) < 0 ? 'text-amber-300' : 'text-sky-300'
                          }`}
                        >
                          {fmtSigned(h.delta_value, 3)}
                        </td>
                        <td className="py-1.5 px-2 font-mono text-right text-white/65">
                          {fmtSigned(h.delta_percent, 1)}%
                        </td>
                        <td className="py-1.5 px-2 text-white/55">
                          {h.significant ? 'yes' : 'no'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-white/35">
                Ranked from {result.hotspots[0]?.selection_basis ?? 'available cells'}.
              </p>
            </section>
          )}

          {/* Caveats */}
          {result.caveats.length > 0 && (
            <section
              aria-labelledby="whatif-caveat-heading"
              className="flex flex-col gap-2 p-3 bg-amber-500/[0.07] border border-amber-500/25 rounded-lg"
            >
              <h3
                id="whatif-caveat-heading"
                className="text-xs font-semibold text-amber-200 tracking-wide uppercase flex items-center gap-1.5"
              >
                <AlertTriangle size={13} />
                What this result cannot tell you
              </h3>
              <ul className="flex flex-col gap-1.5 list-disc pl-4">
                {result.caveats.map((c) => (
                  <li key={c} className="text-xs text-amber-100/85 leading-relaxed">{c}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Export */}
          <section aria-labelledby="whatif-export-heading" className="flex flex-col gap-2">
            <h3
              id="whatif-export-heading"
              className="text-sm font-semibold text-white/90 tracking-wide uppercase flex items-center gap-2"
            >
              <Download size={14} className="text-white/50" />
              Download this analysis
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => { downloadWhatIfJson(result, exportMeta); flash('JSON downloaded'); }}
                className="btn-ghost flex items-center justify-center gap-1.5 text-xs py-2"
              >
                <FileJson size={13} /> JSON
              </button>
              <button
                onClick={handlePrint}
                className="btn-ghost flex items-center justify-center gap-1.5 text-xs py-2"
              >
                <Printer size={13} /> PDF
              </button>
              <button
                onClick={() => { downloadWhatIfCsv(result, exportMeta); flash('CSV downloaded'); }}
                className="btn-ghost flex items-center justify-center gap-1.5 text-xs py-2"
              >
                <FileSpreadsheet size={13} /> CSV grid
              </button>
            </div>
            <p className="text-[10px] text-white/35">
              JSON carries the full fit, scatter, per-cell field, and provenance. PDF is a
              formatted report via your browser&apos;s print dialog. CSV is the per-cell
              before/after grid.
            </p>
          </section>

          <p className="text-[10px] text-white/25 text-center">
            {regionLabel(result.region)} &middot; {result.season_label} &middot; fitted in{' '}
            {fmt(result.computation_time_s, 3)} s
          </p>
        </>
      )}
    </div>
  );
}

// ── Small presentational pieces ───────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-white/65">{label}</span>
      {children}
      {hint && <p className="text-[10px] text-white/40 leading-snug">{hint}</p>}
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`text-xs py-1.5 px-2.5 rounded-md border transition-colors text-center ${
        active
          ? 'border-amber-400/70 bg-amber-400/15 text-white font-medium'
          : 'border-white/12 bg-white/[0.03] text-white/55 hover:text-white/80 hover:border-white/25'
      }`}
    >
      {children}
    </button>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      aria-label={ariaLabel}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
      className="bg-white/[0.06] border border-white/15 rounded-md px-2 py-1.5 text-sm w-20
                 text-white font-mono focus:border-amber-400/60 focus:outline-none"
    />
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'good' | 'warn';
}) {
  const color =
    tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-white';
  return (
    <div className="rounded-lg bg-white/[0.04] border border-white/10 p-2 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-white/45">{label}</span>
      <span className={`text-sm font-bold font-mono leading-tight ${color}`}>{value}</span>
      <span className="text-[10px] text-white/35 leading-tight">{note}</span>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: ReturnType<typeof confidenceLevel> }) {
  const styles: Record<string, string> = {
    strong: 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200',
    moderate: 'border-sky-400/50 bg-sky-400/15 text-sky-200',
    weak: 'border-amber-400/50 bg-amber-400/15 text-amber-200',
    none: 'border-red-400/50 bg-red-400/15 text-red-200',
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border shrink-0 ${styles[level]}`}
    >
      {CONFIDENCE_COPY[level].label}
    </span>
  );
}
