/**
 * Panel data-provenance registry.
 *
 * Why this exists: most of the feature panels in `features/` silently substitute
 * hardcoded mock data when their props are empty — `MOCK_UHI_RESULTS`,
 * `MOCK_SST_ANOMALIES`, `generateMockPairs(120)`, `MOCK_LIGHTNING_STRIKES`, and so
 * on. Mounting them without saying so would put fabricated numbers on screen that
 * are visually indistinguishable from model output. The repo's own claims audit
 * (`.kiro/specs/globe-first-weather-ux-refactor/data-claims-audit.md`) already
 * classifies several of these as `unsupported` for exactly that reason.
 *
 * Every panel mounted in the UI must therefore declare where its numbers come
 * from, and the UI must render that declaration. This module is the single source
 * of truth; `ProvenanceBadge` renders it.
 */

/** Where a panel's displayed numbers actually come from. */
export type DataProvenance =
  /** Values originate from VAYU model inference on real input data. */
  | 'model'
  /** Deterministically computed FROM model output (indices, aggregates, scores). */
  | 'derived'
  /** Real measurements from an external live/observational source. */
  | 'observed'
  /** Published literature or a fixed reference table, not computed here. */
  | 'literature'
  /** Illustrative placeholder data. Must be visibly labelled in the UI. */
  | 'demo';

export interface PanelProvenance {
  /** Stable id, matches the component name. */
  id: string;
  /** Human label shown in the panel header. */
  label: string;
  provenance: DataProvenance;
  /** Concrete source: an endpoint, a dataset, a citation, or the mock constant. */
  source: string;
  /** Extra caveat shown in the badge tooltip. */
  note?: string;
}

/**
 * Panels keyed by component name.
 *
 * `demo` entries are not a failure to be hidden — they are features whose data
 * source does not exist yet (no lightning feed, no radar, no ensemble members
 * persisted). Labelling them is what makes showing them acceptable.
 */
export const PANEL_PROVENANCE: Record<string, PanelProvenance> = {
  // ── Driven by real model output via gridCells ──────────────────────────────
  AnomalyDetection: {
    id: 'AnomalyDetection', label: 'Anomaly Detection', provenance: 'derived',
    source: 'VAYU grid_cells vs day-of-year climatology',
  },
  DroughtMonitor: {
    id: 'DroughtMonitor', label: 'Drought Monitor (SPI)', provenance: 'derived',
    source: 'SPI computed from VAYU rainfall history',
  },
  HeatWaveAlert: {
    id: 'HeatWaveAlert', label: 'Heat Wave Alert', provenance: 'derived',
    source: 'IMD heat-wave criteria applied to VAYU tmax',
  },
  MultiHazardView: {
    id: 'MultiHazardView', label: 'Multi-Hazard View', provenance: 'derived',
    source: 'Threshold rules over VAYU grid_cells',
  },
  WatershedAnalysis: {
    id: 'WatershedAnalysis', label: 'Watershed Analysis', provenance: 'derived',
    source: 'Basin aggregation of VAYU rainfall',
  },
  AgricultureAdvisory: {
    id: 'AgricultureAdvisory', label: 'Agriculture Advisory', provenance: 'derived',
    source: 'Crop-stage rules over VAYU forecast cells',
  },
  Explainability: {
    id: 'Explainability', label: 'Explainability', provenance: 'demo',
    source: 'Local attention/SHAP heuristics',
    note: 'Attributions are computed by frontend heuristics, NOT extracted from the trained model.',
  },
  ResolutionDisplay: {
    id: 'ResolutionDisplay', label: 'Resolution', provenance: 'model',
    source: 'Grid metadata from the active bundle',
    note: 'Regional bundles are 0.25 deg; the full-India bundle is 0.5 deg.',
  },
  ReportGenerator: {
    id: 'ReportGenerator', label: 'Report Generator', provenance: 'derived',
    source: 'Renders the active VAYU forecast',
  },
  NLQueryInterface: {
    id: 'NLQueryInterface', label: 'Natural Language Query', provenance: 'derived',
    source: 'Parses queries into local filters over grid_cells',
  },

  // ── Real external endpoints ───────────────────────────────────────────────
  NWPComparison: {
    id: 'NWPComparison', label: 'NWP Comparison', provenance: 'observed',
    source: 'GET /api/nwp-comparison (Open-Meteo: ECMWF IFS, GFS, ICON)',
    note: 'NWP legs are live. Falls back to bundled series if the endpoint is unreachable.',
  },
  Annotations: {
    id: 'Annotations', label: 'Annotations', provenance: 'observed',
    source: 'GET/POST /api/annotations',
    note: 'Queues to localStorage while offline.',
  },
  AIClimateBrief: {
    id: 'AIClimateBrief', label: 'AI Climate Brief', provenance: 'derived',
    source: 'Templated summary of the active VAYU forecast',
  },

  // ── Literature / fixed reference tables ───────────────────────────────────
  ClimateChangeProjection: {
    id: 'ClimateChangeProjection', label: 'Climate Projection', provenance: 'literature',
    source: 'IPCC AR6 regional projections',
    note: 'A published reference table. NOT produced by the VAYU model.',
  },

  // ── No data source yet — must stay labelled ───────────────────────────────
  LightningDetection: {
    id: 'LightningDetection', label: 'Lightning & Thunderstorms', provenance: 'demo',
    source: 'MOCK_LIGHTNING_STRIKES; CAPE estimated from temperature and humidity',
    note: 'No lightning observation feed is connected. Strike positions are illustrative.',
  },
  PrecipitationType: {
    id: 'PrecipitationType', label: 'Precipitation Type', provenance: 'demo',
    source: 'Phase inferred from temperature thresholds; MOCK_SNOW_LINE',
    note: 'No observed precipitation-phase product is connected.',
  },
  EnsembleUncertainty: {
    id: 'EnsembleUncertainty', label: 'Ensemble Uncertainty', provenance: 'demo',
    source: 'synthesizeMockMembers (8 synthetic members)',
    note: 'The model emits MC-dropout spread per cell, but persisted ensemble members do not exist yet.',
  },
  VerificationScoring: {
    id: 'VerificationScoring', label: 'Verification Scoring', provenance: 'demo',
    source: 'generateMockPairs(120)',
    note: 'Real per-lead and categorical scores exist in the trainer test_report.json but are not yet served.',
  },
  HistoricalReplay: {
    id: 'HistoricalReplay', label: 'Historical Replay', provenance: 'demo',
    source: 'syntheticGrid() snapshots',
    note: 'Event snapshots are fabricated. Real 1981-2025 history exists in the bundles but is not yet served per-event.',
  },
  MicroClimateZones: {
    id: 'MicroClimateZones', label: 'Micro-Climate Zones', provenance: 'derived',
    source: 'Clustering over VAYU grid_cells',
    note: 'Falls back to MOCK_GRID_CELLS when no cells are supplied.',
  },
  OrographicAnalysis: {
    id: 'OrographicAnalysis', label: 'Orographic Analysis', provenance: 'derived',
    source: 'Elevation-binned VAYU rainfall',
    note: 'Falls back to MOCK_ELEVATED_CELLS when no cells are supplied.',
  },
  UrbanHeatIsland: {
    id: 'UrbanHeatIsland', label: 'Urban Heat Island', provenance: 'derived',
    source: 'Urban-rural tmax contrast from VAYU cells',
    note: 'Long-term trend values are a fixed table, not fitted here.',
  },
  PopulationExposure: {
    id: 'PopulationExposure', label: 'Population Exposure', provenance: 'derived',
    source: 'WorldPop counts intersected with hazard cells',
  },
  OceanCoastal: {
    id: 'OceanCoastal', label: 'Ocean & Coastal', provenance: 'demo',
    source: 'MOCK_SST_ANOMALIES / MOCK_CVI_RESULTS',
    note: 'OISST SST exists in the bundles but is not yet served to this panel.',
  },
  VegetationHealth: {
    id: 'VegetationHealth', label: 'Vegetation Health', provenance: 'demo',
    source: 'MOCK_VEGETATION_CELLS / MOCK_NDVI_PROFILE',
    note: 'No NDVI product is wired into the pipeline.',
  },
  WaterResources: {
    id: 'WaterResources', label: 'Water Resources', provenance: 'demo',
    source: 'MOCK_FILL_FRACTIONS / MOCK_CATCHMENT_RAINFALL_MM',
    note: 'No reservoir-level feed is connected.',
  },
  EnergyPanel: {
    id: 'EnergyPanel', label: 'Energy Demand', provenance: 'demo',
    source: 'MOCK_GENERATION_CURVE',
    note: 'Demand curve is illustrative; no grid-operator data is connected.',
  },
  APIPortal: {
    id: 'APIPortal', label: 'API Portal', provenance: 'demo',
    source: 'MOCK_STATS usage counters',
    note: 'Endpoint list is real; the usage numbers are placeholders.',
  },
};

/** Provenance entries that must be visibly badged as simulated in the UI. */
export const DEMO_PROVENANCES: ReadonlySet<DataProvenance> = new Set<DataProvenance>(['demo']);

export function isDemo(id: string): boolean {
  const entry = PANEL_PROVENANCE[id];
  return entry ? DEMO_PROVENANCES.has(entry.provenance) : false;
}

export function getProvenance(id: string): PanelProvenance | undefined {
  return PANEL_PROVENANCE[id];
}

/** Short display text per provenance class. */
export const PROVENANCE_LABEL: Record<DataProvenance, string> = {
  model: 'Model output',
  derived: 'Derived from model',
  observed: 'Live source',
  literature: 'Published reference',
  demo: 'Demo / simulated',
};
