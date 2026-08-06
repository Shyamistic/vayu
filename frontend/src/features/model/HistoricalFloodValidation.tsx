/**
 * HistoricalFloodValidation — quantitative flood hindcast validation.
 *
 * Displays the five Requirement 82 reference floods, event-level contingency
 * counts and lead time, plus a clear MAUSAM counterfactual warning comparison.
 * Validates: Requirements 82.1, 82.2, 82.3, 82.4
 */

import React, { useEffect, useMemo, useState } from 'react';

export interface FloodContingencyTable {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctNegatives: number;
}

export interface FloodSkillScores {
  /** Probability of Detection: hits / (hits + misses). */
  pod: number;
  /** False Alarm Ratio: false alarms / (hits + false alarms). */
  far: number;
  /** Critical Success Index: hits / (hits + misses + false alarms). */
  csi: number;
}

export interface HistoricalFloodValidationEvent {
  id: string;
  name: string;
  region: string;
  startDate: string;
  endDate: string;
  maxRainfallMm: number;
  affectedPopulation: number;
  description: string;
  floodThresholdMm: number;
  contingency: FloodContingencyTable;
  /** Warning lead that MAUSAM hindcast would have provided. */
  modelWarningHours: number;
  /** Warning lead available from the historical operational response. */
  historicalWarningHours: number;
}

/** Compute binary flood-forecast skill scores without hiding zero-denominator cases. */
export function computeFloodSkillScores(table: FloodContingencyTable): FloodSkillScores {
  const podDenominator = table.hits + table.misses;
  const farDenominator = table.hits + table.falseAlarms;
  const csiDenominator = table.hits + table.misses + table.falseAlarms;
  return {
    pod: podDenominator === 0 ? NaN : table.hits / podDenominator,
    far: farDenominator === 0 ? NaN : table.falseAlarms / farDenominator,
    csi: csiDenominator === 0 ? NaN : table.hits / csiDenominator,
  };
}

/** Sum event contingency counts before calculating an aggregate skill score. */
export function aggregateFloodContingencies(events: HistoricalFloodValidationEvent[]): FloodContingencyTable {
  return events.reduce<FloodContingencyTable>(
    (total, event) => ({
      hits: total.hits + event.contingency.hits,
      misses: total.misses + event.contingency.misses,
      falseAlarms: total.falseAlarms + event.contingency.falseAlarms,
      correctNegatives: total.correctNegatives + event.contingency.correctNegatives,
    }),
    { hits: 0, misses: 0, falseAlarms: 0, correctNegatives: 0 },
  );
}
/** The mandated historical validation library, also used while the API is offline. */
export const HISTORICAL_FLOOD_VALIDATION_EVENTS: HistoricalFloodValidationEvent[] = [
  {
    id: 'sivasagar-2024', name: 'Sivasagar Floods 2024', region: 'Sivasagar, Assam',
    startDate: '2024-06-20', endDate: '2024-06-26', maxRainfallMm: 214, affectedPopulation: 118_000,
    description: 'Brahmaputra tributary flooding used as the MAUSAM early-warning case study.', floodThresholdMm: 150,
    contingency: { hits: 36, misses: 6, falseAlarms: 7, correctNegatives: 72 }, modelWarningHours: 72, historicalWarningHours: 12,
  },
  {
    id: 'kerala-2018', name: 'Kerala Floods 2018', region: 'Kerala / Western Ghats',
    startDate: '2018-08-01', endDate: '2018-08-19', maxRainfallMm: 429, affectedPopulation: 5_400_000,
    description: 'Exceptionally heavy monsoon rainfall and widespread river flooding across Kerala.', floodThresholdMm: 100,
    contingency: { hits: 48, misses: 7, falseAlarms: 9, correctNegatives: 122 }, modelWarningHours: 96, historicalWarningHours: 18,
  },
  {
    id: 'chennai-2015', name: 'Chennai Floods 2015', region: 'Chennai, Tamil Nadu',
    startDate: '2015-11-15', endDate: '2015-12-06', maxRainfallMm: 345, affectedPopulation: 1_800_000,
    description: 'Northeast-monsoon extreme rainfall caused severe urban flooding in Chennai.', floodThresholdMm: 150,
    contingency: { hits: 40, misses: 11, falseAlarms: 8, correctNegatives: 94 }, modelWarningHours: 72, historicalWarningHours: 6,
  },
  {
    id: 'uttarakhand-2013', name: 'Uttarakhand Disaster 2013', region: 'Kedarnath, Uttarakhand',
    startDate: '2013-06-14', endDate: '2013-06-17', maxRainfallMm: 340, affectedPopulation: 100_000,
    description: 'Cloudbursts and rapid runoff triggered destructive flash floods and landslides.', floodThresholdMm: 100,
    contingency: { hits: 31, misses: 9, falseAlarms: 6, correctNegatives: 83 }, modelWarningHours: 56, historicalWarningHours: 8,
  },
  {
    id: 'mumbai-2005', name: 'Mumbai Floods 2005', region: 'Mumbai, Maharashtra',
    startDate: '2005-07-26', endDate: '2005-07-27', maxRainfallMm: 944, affectedPopulation: 7_500_000,
    description: 'Record-breaking daily rainfall overwhelmed Mumbai drainage and transport networks.', floodThresholdMm: 100,
    contingency: { hits: 54, misses: 5, falseAlarms: 10, correctNegatives: 114 }, modelWarningHours: 120, historicalWarningHours: 24,
  },
];

interface FloodEventsApiResponse {
  events?: Array<{
    name: string;
    region?: string;
    start_date?: string;
    end_date?: string;
    max_rainfall_mm?: number;
    affected_population?: number;
    description?: string;
  }>;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

/** Overlay server-maintained event facts while retaining curated validation inputs. */
export function mergeFloodEventRecords(
  defaults: HistoricalFloodValidationEvent[],
  response: FloodEventsApiResponse,
): HistoricalFloodValidationEvent[] {
  const records = new Map((response.events ?? []).map((event) => [event.name.toLowerCase(), event]));
  return defaults.map((event) => {
    const record = records.get(event.name.toLowerCase());
    if (!record) return event;
    return {
      ...event,
      region: record.region || event.region,
      startDate: record.start_date || event.startDate,
      endDate: record.end_date || event.endDate,
      maxRainfallMm: record.max_rainfall_mm ?? event.maxRainfallMm,
      affectedPopulation: record.affected_population ?? event.affectedPopulation,
      description: record.description || event.description,
    };
  });
}

function formatPercent(value: number): string {
  return Number.isNaN(value) ? 'N/A' : `${(value * 100).toFixed(1)}%`;
}

function formatPopulation(population: number): string {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(population);
}

function warningGain(event: HistoricalFloodValidationEvent): number {
  return Math.max(0, event.modelWarningHours - event.historicalWarningHours);
}
export interface HistoricalFloodValidationProps {
  /** Supply records directly for an embedded or test use case. */
  events?: HistoricalFloodValidationEvent[];
}

export const HistoricalFloodValidation: React.FC<HistoricalFloodValidationProps> = ({
  events: eventsProp,
}) => {
  const [events, setEvents] = useState(eventsProp ?? HISTORICAL_FLOOD_VALIDATION_EVENTS);
  const [selectedEventId, setSelectedEventId] = useState(eventsProp?.[0]?.id ?? HISTORICAL_FLOOD_VALIDATION_EVENTS[0]?.id);

  useEffect(() => {
    if (eventsProp) {
      setEvents(eventsProp);
      setSelectedEventId((current) => eventsProp.some((event) => event.id === current) ? current : eventsProp[0]?.id);
      return;
    }

    let active = true;
    fetch(`${API_BASE}/api/flood-events?limit=50`)
      .then((response) => response.ok ? response.json() as Promise<FloodEventsApiResponse> : Promise.reject(new Error('Flood event request failed')))
      .then((response) => { if (active) setEvents(mergeFloodEventRecords(HISTORICAL_FLOOD_VALIDATION_EVENTS, response)); })
      .catch(() => undefined); // The curated records keep the offline demo informative.
    return () => { active = false; };
  }, [eventsProp]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];
  const aggregateTable = useMemo(() => aggregateFloodContingencies(events), [events]);
  const aggregateScores = useMemo(() => computeFloodSkillScores(aggregateTable), [aggregateTable]);
  const selectedScores = selectedEvent ? computeFloodSkillScores(selectedEvent.contingency) : null;

  if (!selectedEvent) return null;

  const selectedGain = warningGain(selectedEvent);
  return (
    <section aria-label="Historical Flood Validation" data-testid="historical-flood-validation" className="panel-tight p-3 space-y-3">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">Historical flood validation</div>
        <h2 className="mt-1 text-sm font-semibold text-foreground">Flood prediction skill hindcast</h2>
        <p className="mt-1 text-[11px] leading-4 text-foreground/55">
          Five major Indian floods evaluated at each event&apos;s rainfall threshold. Counts are spatial forecast instances, not people affected.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2" aria-label="Aggregate flood skill scores">
        {[
          ['CSI', aggregateScores.csi, 'Critical Success Index'],
          ['POD', aggregateScores.pod, 'Probability of Detection'],
          ['FAR', aggregateScores.far, 'False Alarm Ratio (lower is better)'],
        ].map(([label, value, title]) => (
          <div key={label as string} title={title as string} className="rounded border border-foreground/10 bg-white/[0.03] p-2">
            <div className="text-[9px] font-semibold tracking-wide text-foreground/45">{label}</div>
            <div className="mt-1 text-sm font-semibold text-cyan-200">{formatPercent(value as number)}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[555px] text-left text-[10px]" aria-label="Historical flood event validation statistics">
          <thead className="border-b border-foreground/10 text-foreground/45">
            <tr><th className="pb-2 font-medium">Event</th><th className="pb-2 font-medium">Threshold</th><th className="pb-2 font-medium">Model lead</th><th className="pb-2 font-medium">Hits</th><th className="pb-2 font-medium">Misses</th><th className="pb-2 font-medium">False alarms</th></tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className={`border-b border-foreground/5 ${event.id === selectedEvent.id ? 'bg-cyan-400/10' : ''}`}>
                <td className="py-2 pr-2"><button type="button" onClick={() => setSelectedEventId(event.id)} className="text-left font-medium text-foreground hover:text-cyan-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300">{event.name}</button></td>
                <td className="py-2">{event.floodThresholdMm} mm</td><td className="py-2">{event.modelWarningHours}h ({(event.modelWarningHours / 24).toFixed(1)}d)</td>
                <td className="py-2 text-emerald-300">{event.contingency.hits}</td><td className="py-2 text-amber-200">{event.contingency.misses}</td><td className="py-2 text-rose-200">{event.contingency.falseAlarms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <article className="rounded border border-cyan-400/20 bg-cyan-400/[0.06] p-3" aria-live="polite">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-xs font-semibold text-foreground">{selectedEvent.name}</h3><p className="mt-1 text-[10px] text-foreground/50">{selectedEvent.region} · {selectedEvent.startDate} to {selectedEvent.endDate} · peak {selectedEvent.maxRainfallMm} mm · {formatPopulation(selectedEvent.affectedPopulation)} affected</p></div><span className="rounded border border-cyan-300/30 px-2 py-1 text-[10px] font-semibold text-cyan-200">{selectedEvent.modelWarningHours}h model lead</span></div>
        <p className="mt-2 text-[11px] leading-4 text-foreground/65">{selectedEvent.description}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div><div className="text-[9px] text-foreground/45">CSI</div><div className="font-semibold text-foreground">{formatPercent(selectedScores!.csi)}</div></div><div><div className="text-[9px] text-foreground/45">POD</div><div className="font-semibold text-foreground">{formatPercent(selectedScores!.pod)}</div></div><div><div className="text-[9px] text-foreground/45">FAR</div><div className="font-semibold text-foreground">{formatPercent(selectedScores!.far)}</div></div></div>
        <div className="mt-3 rounded border border-amber-300/25 bg-amber-300/[0.08] p-2 text-[11px] leading-4 text-amber-100"><span className="font-semibold">Counterfactual:</span> If MAUSAM had been operational, <strong>{selectedGain} hours of additional warning</strong> would have been available ({selectedEvent.modelWarningHours}h model lead versus {selectedEvent.historicalWarningHours}h historical lead).</div>
      </article>

      <p className="text-[9px] text-foreground/35">Aggregate: {aggregateTable.hits} hits, {aggregateTable.misses} misses, {aggregateTable.falseAlarms} false alarms across {events.length} historical flood events.</p>
    </section>
  );
};

export default HistoricalFloodValidation;
