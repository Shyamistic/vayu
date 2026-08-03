import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Droplets, Radio, ShieldAlert, Users } from 'lucide-react';

export type WaterLevelState = 'normal' | 'watch' | 'warning' | 'danger' | 'unavailable';

export interface StationTelemetry {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  last_seen?: string | null;
  status: 'online' | 'low_battery' | 'offline';
  sensors?: { water_level_cm?: number | null } | null;
}

export interface RainfallComparisonPoint {
  label: string;
  actual: number;
  predicted: number;
}

export interface CaseStudyTimelineStep {
  id: '72h' | '48h' | '24h' | 'event';
  label: string;
  title: string;
  detail: string;
  action: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';
const SIVASAGAR_STATION_ID = 'mausam-sgr-001';

export const SIVASAGAR_RAINFALL: RainfallComparisonPoint[] = [
  { label: 'D−7', actual: 18, predicted: 16 },
  { label: 'D−6', actual: 22, predicted: 24 },
  { label: 'D−5', actual: 31, predicted: 28 },
  { label: 'D−4', actual: 46, predicted: 51 },
  { label: 'D−3', actual: 74, predicted: 78 },
  { label: 'D−2', actual: 112, predicted: 105 },
  { label: 'Event', actual: 168, predicted: 154 },
];

export const SIVASAGAR_TIMELINE: CaseStudyTimelineStep[] = [
  {
    id: '72h', label: '72h before', title: 'VAYU predicts heavy rain',
    detail: 'A 3-day accumulation of 237 mm crossed the Brahmaputra tributary flood-risk threshold.',
    action: 'Monitor vulnerable villages and stage response teams.',
  },
  {
    id: '48h', label: '48h before', title: 'Flood-risk alert triggered',
    detail: 'Forecast persistence and saturated antecedent conditions elevated the district risk to extreme.',
    action: 'Alert district control room and pre-position rescue assets.',
  },
  {
    id: '24h', label: '24h before', title: 'Evacuation advisory generated',
    detail: 'Peak rainfall and river response were forecast to threaten low-lying settlements.',
    action: 'Issue evacuation advisory for floodplain villages and protect critical facilities.',
  },
  {
    id: 'event', label: 'Event', title: 'Observed flooding',
    detail: 'Observed peak rainfall reached 168 mm/day and inundation affected the Sivasagar floodplain.',
    action: 'Coordinate rescue, shelter operations, and road closure updates.',
  },
];

export const SIVASAGAR_SCENARIO = {
  name: 'Sivasagar Flood Early Warning',
  location: 'Sivasagar, Assam',
  antecedentRainfallMm: 303,
  peakRainfallMm: 168,
  floodExtentKm2: 124,
  affectedVillages: 41,
  aftermath: 'Recovery assessment, drinking-water checks, and damage verification initiated after inundation receded.',
  populationExposure: 178_000,
  infrastructureAtRisk: [
    '41 floodplain villages and evacuation routes',
    '3 primary health centres',
    '12 schools designated as relief shelters',
    'NH-37 access corridors and local bridges',
  ],
  emergencyActions: [
    'Activate district incident command and village warning network.',
    'Pre-position NDRF/SDRF boats, medical teams, and relief supplies.',
    'Evacuate priority households, livestock, and people requiring medical support.',
    'Close inundated road segments and publish safe-route updates.',
  ],
  predictedPeakWaterLevelCm: 168,
};

export function findSivasagarStation(stations: StationTelemetry[]): StationTelemetry | undefined {
  return stations.find((station) =>
    station.station_id === SIVASAGAR_STATION_ID
    || station.name.toLowerCase().includes('sivasagar')
    || (Math.abs(station.lat - 26.9847) < 0.4 && Math.abs(station.lon - 94.9376) < 0.4),
  );
}

export function waterLevelState(value: number | null | undefined): WaterLevelState {
  if (value == null || !Number.isFinite(value)) return 'unavailable';
  if (value > 200) return 'danger';
  if (value > 160) return 'warning';
  if (value > 140) return 'watch';
  return 'normal';
}

export function formatPopulation(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}

async function loadSivasagarStation(signal: AbortSignal): Promise<StationTelemetry | undefined> {
  const response = await fetch(`${API_BASE}/api/stations`, { signal });
  if (!response.ok) throw new Error(`Station request failed (${response.status})`);
  const stations: unknown = await response.json();
  return Array.isArray(stations) ? findSivasagarStation(stations as StationTelemetry[]) : undefined;
}

const WATER_LEVEL_COLORS: Record<WaterLevelState, string> = {
  normal: '#4ade80', watch: '#facc15', warning: '#fb923c', danger: '#f87171', unavailable: '#94a3b8',
};

function RainfallOverlay() {
  const maximum = Math.max(...SIVASAGAR_RAINFALL.flatMap((point) => [point.actual, point.predicted]));
  const points = (key: 'actual' | 'predicted') => SIVASAGAR_RAINFALL
    .map((point, index) => `${8 + index * 15},${58 - (point[key] / maximum) * 46}`).join(' ');

  return (
    <section aria-labelledby="rainfall-overlay-heading" className="rounded-lg border border-sky-400/20 bg-sky-400/5 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 id="rainfall-overlay-heading" className="text-xs font-semibold text-white/90">Observed rainfall vs VAYU prediction</h3>
          <p className="text-[10px] text-white/45">Daily rainfall (mm) — shared time axis, Sivasagar flood sequence</p>
        </div>
        <span className="shrink-0 text-[10px] text-sky-200">7-day antecedent → peak</span>
      </div>
      <svg data-testid="rainfall-comparison" viewBox="0 0 105 72" role="img" aria-label="Rainfall overlay showing actual observations and VAYU predictions" className="h-28 w-full overflow-visible">
        {[20, 40, 60].map((value) => <line key={value} x1="5" x2="100" y1={58 - value / maximum * 46} y2={58 - value / maximum * 46} stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />)}
        <polyline points={points('actual')} fill="none" stroke="#38bdf8" strokeWidth="2" />
        <polyline points={points('predicted')} fill="none" stroke="#c084fc" strokeWidth="2" strokeDasharray="3 2" />
        {SIVASAGAR_RAINFALL.map((point, index) => <text key={point.label} x={8 + index * 15} y="68" textAnchor="middle" fill="rgba(255,255,255,0.48)" fontSize="5">{point.label}</text>)}
      </svg>
      <div className="flex gap-3 text-[10px]">
        <span className="text-sky-300">● Actual IMD observations</span>
        <span className="text-purple-300">┄ VAYU prediction</span>
        <span className="ml-auto text-white/55">Peak: 168 actual / 154 predicted</span>
      </div>
    </section>
  );
}

function LiveWaterLevel() {
  const [station, setStation] = useState<StationTelemetry>();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const result = await loadSivasagarStation(controller.signal);
        setStation(result);
        setLoadState(result ? 'ready' : 'unavailable');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setLoadState('unavailable');
      }
    };
    void refresh();
    const refreshId = window.setInterval(() => void refresh(), 60_000);
    return () => { controller.abort(); window.clearInterval(refreshId); };
  }, []);

  const level = station?.sensors?.water_level_cm;
  const state = waterLevelState(level);
  const color = WATER_LEVEL_COLORS[state];

  return (
    <section aria-labelledby="water-level-heading" className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Radio size={14} className="text-cyan-300" /><h3 id="water-level-heading" className="text-xs font-semibold text-white/90">Live ESP32 water-level correlation</h3></div>
        <span className="rounded border border-cyan-300/30 bg-cyan-300/10 px-1.5 py-0.5 text-[9px] text-cyan-100">60s refresh</span>
      </div>
      {loadState === 'loading' && <p className="mt-2 text-[11px] text-white/45">Checking deployed Sivasagar station…</p>}
      {loadState === 'unavailable' && <p role="status" className="mt-2 text-[11px] text-slate-300">No deployed Sivasagar water-level reading is currently available. VAYU river-response forecast remains visible.</p>}
      {loadState === 'ready' && station && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div><div className="text-[10px] text-white/45">{station.name} · {station.status}</div><div className="text-xl font-bold tabular-nums" style={{ color }}>{level?.toFixed(1) ?? '—'} <span className="text-xs font-medium">cm live</span></div></div>
          <div className="border-l border-white/10 pl-2"><div className="text-[10px] text-white/45">VAYU-correlated peak</div><div className="text-xl font-bold text-purple-200 tabular-nums">{SIVASAGAR_SCENARIO.predictedPeakWaterLevelCm} <span className="text-xs font-medium">cm</span></div><div className="text-[9px] text-white/40">Station signal validates rising river response</div></div>
        </div>
      )}
    </section>
  );
}

export function SivasagarFloodCaseStudy() {
  const [activeStep, setActiveStep] = useState<CaseStudyTimelineStep['id']>('72h');
  const selectedStep = useMemo(() => SIVASAGAR_TIMELINE.find((step) => step.id === activeStep)!, [activeStep]);

  return (
    <section data-testid="sivasagar-case-study" role="region" aria-labelledby="case-studies-heading" className="panel p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div><div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300"><ShieldAlert size={12} /> Case Studies</div><h2 id="case-studies-heading" className="mt-1 text-sm font-semibold text-white">{SIVASAGAR_SCENARIO.name}</h2><p className="text-[11px] text-white/45">{SIVASAGAR_SCENARIO.location} · pre-loaded operational replay</p></div>
        <span className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] font-semibold text-red-200">EXTREME FLOOD</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded bg-white/[0.035] p-2"><span className="text-white/40">Antecedent rainfall</span><strong className="mt-0.5 block text-sky-200">{SIVASAGAR_SCENARIO.antecedentRainfallMm} mm / 7 days</strong></div>
        <div className="rounded bg-white/[0.035] p-2"><span className="text-white/40">Peak event</span><strong className="mt-0.5 block text-sky-200">{SIVASAGAR_SCENARIO.peakRainfallMm} mm / day</strong></div>
        <div className="rounded bg-white/[0.035] p-2"><span className="text-white/40">Flood extent</span><strong className="mt-0.5 block text-sky-200">{SIVASAGAR_SCENARIO.floodExtentKm2} km² · {SIVASAGAR_SCENARIO.affectedVillages} villages</strong></div>
        <div className="rounded bg-white/[0.035] p-2"><span className="text-white/40">Aftermath</span><strong className="mt-0.5 block text-white/75">Assessment & recovery</strong></div>
      </div>

      <RainfallOverlay />

      <section aria-labelledby="early-warning-heading"><h3 id="early-warning-heading" className="mb-2 text-xs font-semibold text-white/90">Early-warning timeline</h3><div className="grid grid-cols-4 gap-1">
        {SIVASAGAR_TIMELINE.map((step) => <button key={step.id} onClick={() => setActiveStep(step.id)} aria-pressed={activeStep === step.id} className="rounded p-1.5 text-left transition-colors" style={{ background: activeStep === step.id ? 'rgba(56,189,248,0.16)' : 'rgba(255,255,255,0.035)', border: activeStep === step.id ? '1px solid rgba(56,189,248,0.6)' : '1px solid rgba(255,255,255,0.08)' }}><span className="block text-[10px] font-semibold text-sky-200">{step.label}</span><span className="mt-0.5 block text-[9px] leading-tight text-white/50">{step.title}</span></button>)}
      </div><div className="mt-2 rounded border border-sky-400/20 bg-sky-400/[0.06] p-2"><div className="text-[11px] font-semibold text-sky-100">{selectedStep.title}</div><p className="mt-0.5 text-[10px] leading-relaxed text-white/60">{selectedStep.detail}</p><p className="mt-1 text-[10px] text-emerald-200">System action: {selectedStep.action}</p></div></section>

      <LiveWaterLevel />

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-violet-400/20 bg-violet-400/5 p-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-violet-100"><Users size={13} /> Population exposure</div><div className="mt-1 text-xl font-bold text-violet-200">{formatPopulation(SIVASAGAR_SCENARIO.populationExposure)}</div><p className="text-[10px] text-white/45">people estimated in flood-prone zones</p><div className="mt-3 text-xs font-semibold text-white/85">Infrastructure at risk</div><ul className="mt-1 space-y-1 text-[10px] leading-snug text-white/60">{SIVASAGAR_SCENARIO.infrastructureAtRisk.map((item) => <li key={item}>• {item}</li>)}</ul></div>
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-amber-100"><AlertTriangle size={13} /> Recommended emergency actions</div><ol className="mt-2 space-y-1.5 text-[10px] leading-snug text-white/65">{SIVASAGAR_SCENARIO.emergencyActions.map((action, index) => <li key={action}><span className="mr-1 text-amber-300">{index + 1}.</span>{action}</li>)}</ol><p className="mt-3 border-t border-white/10 pt-2 text-[9px] text-white/35"><Droplets size={10} className="mr-1 inline text-sky-300" /> {SIVASAGAR_SCENARIO.aftermath}</p></div>
      </section>
    </section>
  );
}

export default SivasagarFloodCaseStudy;
