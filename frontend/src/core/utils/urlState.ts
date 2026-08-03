/**
 * URL State Encoding Utilities
 *
 * Encode AppState into URL query parameters and decode them back.
 * Supports: viewMode, region, variable, forecastDay, camera position, active layers.
 *
 * Requirement 28.3: WHEN the user clicks "Share View", THE Dashboard SHALL
 * generate a URL encoding current view state (region, variable, date, camera
 * position, layers) as query parameters.
 */

import type { ViewMode, VariableId, RegionId } from '../../types';
import type { CameraState, EarthLayer } from '../state/mapStore';

// ── Shareable state shape ────────────────────────────────────────────────────

/**
 * The subset of application state that is serialisable into URL params.
 * Intentionally flat — no nested objects except camera which is encoded
 * as individual numeric params.
 */
export interface ShareableAppState {
  viewMode: ViewMode;
  region: RegionId;
  variable: VariableId;
  forecastDay: number; // 1–7
  camera: CameraState;
  /** Active map layer (e.g. "satellite", "photorealistic") */
  activeLayer: EarthLayer;
  /** Feature-toggle layer flags */
  layers: {
    showHeatmap: boolean;
    showWind: boolean;
    showContours: boolean;
    showBoundaries: boolean;
    showUncertainty: boolean;
  };
}

// ── Valid value sets for validation ──────────────────────────────────────────

const VALID_VIEW_MODES = new Set<ViewMode>([
  'prediction', 'historical', 'scenario', 'metrics', 'agriculture', 'environment',
]);

const VALID_REGIONS = new Set<RegionId>([
  'western_ghats', 'north_east_india', 'indo_gangetic_plain', 'central_india', 'pilot',
]);

const VALID_VARIABLES = new Set<VariableId>(['rainfall', 'temp_max', 'temp_min']);

const VALID_EARTH_LAYERS = new Set<EarthLayer>([
  'satellite', 'modis', 'precipitation', 'cloud', 'sst', 'photorealistic',
]);

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_STATE: ShareableAppState = {
  viewMode: 'prediction',
  region: 'western_ghats',
  variable: 'rainfall',
  forecastDay: 1,
  camera: {
    latitude: 20.5937,
    longitude: 78.9629,
    altitude: 5_000_000,
    heading: 0,
    pitch: -90,
    roll: 0,
  },
  activeLayer: 'satellite',
  layers: {
    showHeatmap: true,
    showWind: false,
    showContours: false,
    showBoundaries: false,
    showUncertainty: false,
  },
};

// ── Encoding ─────────────────────────────────────────────────────────────────

/**
 * Encode a ShareableAppState into a query string (without the leading "?").
 *
 * Camera coordinates are rounded to 6 decimal places to keep URLs short.
 * Boolean flags are encoded as "1" / "0".
 */
export function encodeAppState(state: ShareableAppState): string {
  const params = new URLSearchParams();

  // Scalar state
  params.set('vm', state.viewMode);
  params.set('r', state.region);
  params.set('v', state.variable);
  params.set('fd', String(state.forecastDay));

  // Camera — 6 dp for lat/lon, 0 dp for altitude/angles
  params.set('clat', state.camera.latitude.toFixed(6));
  params.set('clon', state.camera.longitude.toFixed(6));
  params.set('calt', state.camera.altitude.toFixed(0));
  params.set('ch', state.camera.heading.toFixed(4));
  params.set('cp', state.camera.pitch.toFixed(4));
  params.set('cr', state.camera.roll.toFixed(4));

  // Active earth layer
  params.set('al', state.activeLayer);

  // Feature-toggle layers (boolean → "1"/"0")
  params.set('hm', state.layers.showHeatmap ? '1' : '0');
  params.set('wn', state.layers.showWind ? '1' : '0');
  params.set('ct', state.layers.showContours ? '1' : '0');
  params.set('bd', state.layers.showBoundaries ? '1' : '0');
  params.set('un', state.layers.showUncertainty ? '1' : '0');

  return params.toString();
}

// ── Decoding ─────────────────────────────────────────────────────────────────

/**
 * Parse a number from a URLSearchParams value.
 * Returns `fallback` if the param is absent or not a finite number.
 */
function parseNum(
  params: URLSearchParams,
  key: string,
  fallback: number,
): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a boolean flag from a URLSearchParams value ("1" → true, anything else → false).
 * Returns `fallback` when the param is absent.
 */
function parseBool(
  params: URLSearchParams,
  key: string,
  fallback: boolean,
): boolean {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return raw === '1';
}

/**
 * Decode URL query parameters (full URL or just query string) into a
 * ShareableAppState. Unknown or invalid values fall back to defaults.
 */
export function decodeAppState(urlOrSearch: string): ShareableAppState {
  // Accept a full URL ("https://…?foo=bar") or bare query string ("foo=bar")
  let search = urlOrSearch;
  try {
    const url = new URL(urlOrSearch);
    search = url.search; // includes the leading "?"
  } catch {
    // Not a full URL — treat as a raw query string
  }

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  // viewMode
  const rawVm = params.get('vm') ?? '';
  const viewMode: ViewMode = VALID_VIEW_MODES.has(rawVm as ViewMode)
    ? (rawVm as ViewMode)
    : DEFAULT_STATE.viewMode;

  // region
  const rawR = params.get('r') ?? '';
  const region: RegionId = VALID_REGIONS.has(rawR as RegionId)
    ? (rawR as RegionId)
    : DEFAULT_STATE.region;

  // variable
  const rawV = params.get('v') ?? '';
  const variable: VariableId = VALID_VARIABLES.has(rawV as VariableId)
    ? (rawV as VariableId)
    : DEFAULT_STATE.variable;

  // forecastDay — clamp to [1, 7]
  const forecastDay = Math.max(
    1,
    Math.min(7, Math.round(parseNum(params, 'fd', DEFAULT_STATE.forecastDay))),
  );

  // camera
  const camera: CameraState = {
    latitude: parseNum(params, 'clat', DEFAULT_STATE.camera.latitude),
    longitude: parseNum(params, 'clon', DEFAULT_STATE.camera.longitude),
    altitude: parseNum(params, 'calt', DEFAULT_STATE.camera.altitude),
    heading: parseNum(params, 'ch', DEFAULT_STATE.camera.heading),
    pitch: parseNum(params, 'cp', DEFAULT_STATE.camera.pitch),
    roll: parseNum(params, 'cr', DEFAULT_STATE.camera.roll),
  };

  // activeLayer
  const rawAl = params.get('al') ?? '';
  const activeLayer: EarthLayer = VALID_EARTH_LAYERS.has(rawAl as EarthLayer)
    ? (rawAl as EarthLayer)
    : DEFAULT_STATE.activeLayer;

  // Feature-toggle layers
  const layers = {
    showHeatmap: parseBool(params, 'hm', DEFAULT_STATE.layers.showHeatmap),
    showWind: parseBool(params, 'wn', DEFAULT_STATE.layers.showWind),
    showContours: parseBool(params, 'ct', DEFAULT_STATE.layers.showContours),
    showBoundaries: parseBool(params, 'bd', DEFAULT_STATE.layers.showBoundaries),
    showUncertainty: parseBool(params, 'un', DEFAULT_STATE.layers.showUncertainty),
  };

  return { viewMode, region, variable, forecastDay, camera, activeLayer, layers };
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/**
 * Build a full shareable URL from the current page origin + pathname + encoded state.
 * Safe to call in browser environments; falls back to a relative URL in non-browser contexts.
 */
export function buildShareUrl(state: ShareableAppState): string {
  const qs = encodeAppState(state);
  if (typeof window !== 'undefined') {
    const { origin, pathname } = window.location;
    return `${origin}${pathname}?${qs}`;
  }
  return `?${qs}`;
}

/**
 * Decode the current page URL into a ShareableAppState.
 * Returns defaults when called outside a browser environment.
 */
export function decodeCurrentUrl(): ShareableAppState {
  if (typeof window !== 'undefined') {
    return decodeAppState(window.location.href);
  }
  return { ...DEFAULT_STATE };
}
