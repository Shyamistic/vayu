/**
 * Before/after comparison plus the past → current → projected timeline.
 *
 * Rendered with plain CSS rather than a chart library: these are four bars with
 * error whiskers, and hand-drawn bars keep the projected bar visually distinct
 * (hatched, dashed outline) from the measured ones. That distinction is the whole
 * point — two of these bars are observations and one is an extrapolation, and a
 * reader must not have to consult a legend to tell which.
 */

import type { EpochSummary, WhatIfResponse } from '../../types';
import {
  fmt,
  fmtSigned,
  fmtVolume,
  fmtCI,
  orderEpochs,
  distributionShares,
} from './whatIfFormat';

export interface WhatIfBeforeAfterProps {
  result: WhatIfResponse;
}

/** Shared bar scaling so every bar in a group is comparable by eye. */
function barScale(values: number[]): (v: number) => number {
  const max = Math.max(...values.filter((v) => Number.isFinite(v)), 0);
  return (v: number) => (max > 0 && Number.isFinite(v) ? Math.max(2, (100 * v) / max) : 0);
}

function ChangeArrow({ delta }: { delta: number | null }) {
  if (delta === null || !Number.isFinite(delta) || delta === 0) {
    return <span className="text-foreground/40 text-2xl leading-none">→</span>;
  }
  const drying = delta < 0;
  return (
    <span
      className={`text-2xl leading-none ${drying ? 'text-amber-400' : 'text-sky-400'}`}
      aria-hidden="true"
    >
      {drying ? '↘' : '↗'}
    </span>
  );
}

export default function WhatIfBeforeAfter({ result }: WhatIfBeforeAfterProps) {
  const { regional, integral, distribution } = result;
  const unit = regional.unit;
  const epochs = orderEpochs(result.epochs);
  const shares = distributionShares(result);

  const drying = (regional.delta ?? 0) < 0;
  const deltaColor = drying ? 'text-amber-400' : 'text-sky-400';

  const scaleBA = barScale([regional.baseline ?? 0, regional.scenario ?? 0]);
  const scaleEpoch = barScale(epochs.map((e) => e.value ?? 0));

  return (
    <div className="flex flex-col gap-5">
      {/* ── Before / after ─────────────────────────────────────────────────── */}
      <section aria-labelledby="whatif-ba-heading" className="flex flex-col gap-3">
        <h3
          id="whatif-ba-heading"
          className="text-sm font-semibold text-foreground/90 tracking-wide uppercase"
        >
          Before &rarr; After
        </h3>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
          <BeforeAfterCard
            caption="Before"
            sublabel="Observed baseline"
            value={regional.baseline}
            unit={unit}
            barPct={scaleBA(regional.baseline ?? 0)}
            barClass="bg-foreground/35"
          />

          <div className="flex flex-col items-center justify-center gap-1 px-1">
            <ChangeArrow delta={regional.delta} />
            <span className={`text-base font-bold font-mono ${deltaColor}`}>
              {fmtSigned(regional.delta, 2)}
            </span>
            <span className="text-xs text-foreground/50">{unit}</span>
            <span className={`text-sm font-semibold ${deltaColor}`}>
              {fmtSigned(regional.delta_percent, 1)}%
            </span>
          </div>

          <BeforeAfterCard
            caption="After"
            sublabel="Projected"
            value={regional.scenario}
            unit={unit}
            barPct={scaleBA(regional.scenario ?? 0)}
            barClass={drying ? 'bg-amber-500/70' : 'bg-sky-500/70'}
            projected
          />
        </div>

        <p className="text-xs text-foreground/55">
          95 % confidence interval on the change:{' '}
          <span className="font-mono text-foreground/80">
            {fmtCI(regional.delta_ci95_low, regional.delta_ci95_high, 2)} {unit}
          </span>
          {regional.delta_ci95_low !== null &&
            regional.delta_ci95_high !== null &&
            regional.delta_ci95_low * regional.delta_ci95_high < 0 && (
              <span className="text-amber-300/90">
                {' '}
                — the interval spans zero, so even the direction of change is uncertain.
              </span>
            )}
        </p>
      </section>

      {/* ── Domain integral ────────────────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-2">
        <Metric
          label="Baseline water volume"
          value={fmt(integral.baseline_volume_km3, 0)}
          unit="km³"
          note="Over the whole season and region"
        />
        <Metric
          label="Change in volume"
          value={fmtVolume(integral.delta_volume_km3)}
          unit=""
          note="Area integral of ∂R/∂T · ΔT"
          emphasis={drying ? 'warm' : 'cool'}
        />
        <Metric
          label="Region area"
          value={fmt(integral.area_km2, 0)}
          unit="km²"
          note="Cells with observations"
        />
      </section>

      {/* ── Past / current / future ────────────────────────────────────────── */}
      <section aria-labelledby="whatif-timeline-heading" className="flex flex-col gap-3">
        <h3
          id="whatif-timeline-heading"
          className="text-sm font-semibold text-foreground/90 tracking-wide uppercase"
        >
          Past &middot; Current &middot; Projected
        </h3>

        <div className="grid grid-cols-3 gap-3 items-end" style={{ minHeight: 150 }}>
          {epochs.map((epoch) => (
            <EpochBar
              key={epoch.id}
              epoch={epoch}
              unit={unit}
              heightPct={scaleEpoch(epoch.value ?? 0)}
            />
          ))}
        </div>

        <p className="text-xs text-foreground/55">
          Past and current bars are measured means from the observed record with their
          interannual 95 % interval. The projected bar applies the fitted sensitivity to the
          current baseline — it is an extrapolation of an observed relationship, not a forecast.
        </p>
      </section>

      {/* ── Spatial distribution ───────────────────────────────────────────── */}
      <section aria-labelledby="whatif-dist-heading" className="flex flex-col gap-2">
        <h3
          id="whatif-dist-heading"
          className="text-sm font-semibold text-foreground/90 tracking-wide uppercase"
        >
          Spatial response
        </h3>

        <div
          className="flex h-7 w-full overflow-hidden rounded-md border border-foreground/15"
          role="img"
          aria-label={
            `${distribution.cells_drier} of ${distribution.cells_total} cells drier, ` +
            `${distribution.cells_wetter} wetter`
          }
        >
          {shares.drierPct > 0 && (
            <div
              className="bg-amber-500/70 flex items-center justify-center"
              style={{ width: `${shares.drierPct}%` }}
              title={`${distribution.cells_drier} cells drier`}
            >
              {shares.drierPct > 14 && (
                <span className="text-xs font-semibold text-black/75">
                  {shares.drierPct.toFixed(0)}% drier
                </span>
              )}
            </div>
          )}
          {shares.wetterPct > 0 && (
            <div
              className="bg-sky-500/70 flex items-center justify-center"
              style={{ width: `${shares.wetterPct}%` }}
              title={`${distribution.cells_wetter} cells wetter`}
            >
              {shares.wetterPct > 14 && (
                <span className="text-xs font-semibold text-black/75">
                  {shares.wetterPct.toFixed(0)}% wetter
                </span>
              )}
            </div>
          )}
          {shares.neutralPct > 0 && (
            <div className="bg-foreground/10" style={{ width: `${shares.neutralPct}%` }} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-foreground/65">
          <span>
            Grid cells analysed:{' '}
            <span className="font-mono text-foreground/85">{distribution.cells_total}</span>
          </span>
          <span>
            Locally significant (p &lt; 0.05):{' '}
            <span className="font-mono text-foreground/85">{distribution.cells_significant}</span>
          </span>
          <span>
            Drier: <span className="font-mono text-amber-300">{distribution.cells_drier}</span>
          </span>
          <span>
            Wetter: <span className="font-mono text-sky-300">{distribution.cells_wetter}</span>
          </span>
        </div>
        {distribution.cells_significant < distribution.cells_total / 2 && (
          <p className="text-xs text-amber-300/85">
            Fewer than half the cells have a locally significant slope. The regional aggregate
            is more reliable than any individual cell.
          </p>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BeforeAfterCard({
  caption,
  sublabel,
  value,
  unit,
  barPct,
  barClass,
  projected = false,
}: {
  caption: string;
  sublabel: string;
  value: number | null;
  unit: string;
  barPct: number;
  barClass: string;
  projected?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg p-3 bg-foreground/[0.04] border ${
        projected ? 'border-dashed border-foreground/30' : 'border-foreground/12'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
          {caption}
        </span>
        <span className="text-[10px] text-foreground/40">{sublabel}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold font-mono text-foreground leading-none">
          {fmt(value, 2)}
        </span>
        <span className="text-xs text-foreground/50">{unit}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-foreground/[0.07] overflow-hidden">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

function EpochBar({
  epoch,
  unit,
  heightPct,
}: {
  epoch: EpochSummary;
  unit: string;
  heightPct: number;
}) {
  const projected = !epoch.observed;
  const drying = (epoch.delta_vs_current ?? 0) < 0;
  const fill = projected
    ? drying
      ? 'bg-amber-500/45 border border-dashed border-amber-300/70'
      : 'bg-sky-500/45 border border-dashed border-sky-300/70'
    : 'bg-foreground/25 border border-foreground/20';

  // Whisker length is expressed relative to the bar so it scales with the bar.
  const whiskerPct =
    epoch.uncertainty !== null && epoch.value ? (100 * epoch.uncertainty) / epoch.value : 0;

  return (
    <div className="flex flex-col items-center gap-2 h-full justify-end">
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-base font-bold font-mono text-foreground leading-none">
          {fmt(epoch.value, 2)}
        </span>
        {epoch.uncertainty !== null && Number.isFinite(epoch.uncertainty) && (
          <span className="text-[10px] text-foreground/45 font-mono">
            ± {fmt(epoch.uncertainty, 2)}
          </span>
        )}
      </div>

      <div className="relative w-full flex items-end justify-center" style={{ height: 82 }}>
        <div
          className={`w-3/5 rounded-t ${fill}`}
          style={{ height: `${Math.min(100, heightPct)}%` }}
        />
        {whiskerPct > 0 && (
          <div
            className="absolute left-1/2 -translate-x-1/2 border-l border-foreground/55"
            style={{
              bottom: `${Math.min(100, heightPct)}%`,
              height: `${Math.min(28, whiskerPct * 0.9)}%`,
            }}
            aria-hidden="true"
          >
            <div className="absolute -left-1.5 top-0 w-3 border-t border-foreground/55" />
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-xs text-foreground/75 leading-tight">{epoch.label}</span>
        <span
          className={`text-[10px] uppercase tracking-wider ${
            projected ? 'text-amber-300/80' : 'text-foreground/40'
          }`}
        >
          {projected ? 'Projected' : 'Observed'}
        </span>
        {epoch.id !== 'current' && epoch.delta_vs_current !== null && (
          <span className="text-[10px] font-mono text-foreground/55">
            {fmtSigned(epoch.delta_vs_current, 2)} {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
  emphasis?: 'warm' | 'cool';
}) {
  const color =
    emphasis === 'warm' ? 'text-amber-400' : emphasis === 'cool' ? 'text-sky-400' : 'text-foreground';
  return (
    <div className="rounded-lg bg-foreground/[0.04] border border-foreground/10 p-2.5 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-foreground/50 leading-tight">
        {label}
      </span>
      <span className={`text-lg font-bold font-mono leading-none ${color}`}>
        {value}
        {unit && <span className="text-xs text-foreground/45 font-normal ml-1">{unit}</span>}
      </span>
      <span className="text-[10px] text-foreground/35 leading-tight">{note}</span>
    </div>
  );
}
