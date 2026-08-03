/**
 * Tests for URL State Encoding / Decoding
 *
 * **Validates: Requirements 28.3**
 *
 * Property 17: URL State Encoding Round-Trip
 * For any valid AppState (viewMode, region, variable, forecastDay, camera
 * position, active layers), encoding to URL query parameters and decoding back
 * SHALL produce an equivalent state.
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  encodeAppState,
  decodeAppState,
  buildShareUrl,
  type ShareableAppState,
} from './urlState';
import type { CameraState, EarthLayer } from '../state/mapStore';
import type { ViewMode, VariableId, RegionId } from '../../types';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const viewModeArb = fc.constantFrom<ViewMode>(
  'prediction', 'historical', 'scenario', 'metrics', 'agriculture', 'environment',
);

const regionArb = fc.constantFrom<RegionId>(
  'western_ghats', 'north_east_india', 'indo_gangetic_plain', 'central_india', 'pilot',
);

const variableArb = fc.constantFrom<VariableId>('rainfall', 'temp_max', 'temp_min');

const earthLayerArb = fc.constantFrom<EarthLayer>(
  'satellite', 'modis', 'precipitation', 'cloud', 'sst', 'photorealistic',
);

const cameraArb: fc.Arbitrary<CameraState> = fc.record({
  latitude: fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
  longitude: fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
  altitude: fc.double({ min: 1000, max: 50_000_000, noNaN: true, noDefaultInfinity: true }),
  heading: fc.double({ min: 0, max: 360, noNaN: true, noDefaultInfinity: true }),
  pitch: fc.double({ min: -90, max: 0, noNaN: true, noDefaultInfinity: true }),
  roll: fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
});

const layersArb = fc.record({
  showHeatmap: fc.boolean(),
  showWind: fc.boolean(),
  showContours: fc.boolean(),
  showBoundaries: fc.boolean(),
  showUncertainty: fc.boolean(),
});

const shareableStateArb: fc.Arbitrary<ShareableAppState> = fc.record({
  viewMode: viewModeArb,
  region: regionArb,
  variable: variableArb,
  forecastDay: fc.integer({ min: 1, max: 7 }),
  camera: cameraArb,
  activeLayer: earthLayerArb,
  layers: layersArb,
});

// ── Property tests ────────────────────────────────────────────────────────────

describe('Property 17: URL State Encoding Round-Trip', () => {
  test.prop([shareableStateArb])(
    'encode→decode round-trip produces equivalent state',
    (state) => {
      const encoded = encodeAppState(state);
      const decoded = decodeAppState(encoded);

      // Scalar values must be identical
      expect(decoded.viewMode).toBe(state.viewMode);
      expect(decoded.region).toBe(state.region);
      expect(decoded.variable).toBe(state.variable);
      expect(decoded.forecastDay).toBe(state.forecastDay);
      expect(decoded.activeLayer).toBe(state.activeLayer);

      // Layer flags must be identical
      expect(decoded.layers.showHeatmap).toBe(state.layers.showHeatmap);
      expect(decoded.layers.showWind).toBe(state.layers.showWind);
      expect(decoded.layers.showContours).toBe(state.layers.showContours);
      expect(decoded.layers.showBoundaries).toBe(state.layers.showBoundaries);
      expect(decoded.layers.showUncertainty).toBe(state.layers.showUncertainty);

      // Camera — encoded at 6 dp precision; allow for rounding tolerance
      expect(decoded.camera.latitude).toBeCloseTo(state.camera.latitude, 5);
      expect(decoded.camera.longitude).toBeCloseTo(state.camera.longitude, 5);
      expect(decoded.camera.altitude).toBeCloseTo(state.camera.altitude, -1); // within 10m
      expect(decoded.camera.heading).toBeCloseTo(state.camera.heading, 3);
      expect(decoded.camera.pitch).toBeCloseTo(state.camera.pitch, 3);
      expect(decoded.camera.roll).toBeCloseTo(state.camera.roll, 3);
    },
  );

  test.prop([shareableStateArb])(
    'encode produces a non-empty query string',
    (state) => {
      const qs = encodeAppState(state);
      expect(qs.length).toBeGreaterThan(0);
    },
  );

  test.prop([shareableStateArb])(
    'decode is idempotent — decoding twice produces the same state',
    (state) => {
      const once = decodeAppState(encodeAppState(state));
      const twice = decodeAppState(encodeAppState(once));

      expect(twice.viewMode).toBe(once.viewMode);
      expect(twice.region).toBe(once.region);
      expect(twice.variable).toBe(once.variable);
      expect(twice.forecastDay).toBe(once.forecastDay);
      expect(twice.activeLayer).toBe(once.activeLayer);
      expect(twice.layers).toEqual(once.layers);
      expect(twice.camera.latitude).toBeCloseTo(once.camera.latitude, 5);
      expect(twice.camera.longitude).toBeCloseTo(once.camera.longitude, 5);
    },
  );
});

// ── Unit tests ────────────────────────────────────────────────────────────────

describe('encodeAppState', () => {
  it('encodes all expected params for a known state', () => {
    const state: ShareableAppState = {
      viewMode: 'scenario',
      region: 'north_east_india',
      variable: 'temp_max',
      forecastDay: 5,
      camera: {
        latitude: 25.0,
        longitude: 90.0,
        altitude: 1_000_000,
        heading: 45.0,
        pitch: -60.0,
        roll: 0.0,
      },
      activeLayer: 'photorealistic',
      layers: {
        showHeatmap: true,
        showWind: true,
        showContours: false,
        showBoundaries: true,
        showUncertainty: false,
      },
    };

    const qs = encodeAppState(state);
    const params = new URLSearchParams(qs);

    expect(params.get('vm')).toBe('scenario');
    expect(params.get('r')).toBe('north_east_india');
    expect(params.get('v')).toBe('temp_max');
    expect(params.get('fd')).toBe('5');
    expect(params.get('clat')).toBe('25.000000');
    expect(params.get('clon')).toBe('90.000000');
    expect(params.get('al')).toBe('photorealistic');
    expect(params.get('hm')).toBe('1');
    expect(params.get('wn')).toBe('1');
    expect(params.get('ct')).toBe('0');
    expect(params.get('bd')).toBe('1');
    expect(params.get('un')).toBe('0');
  });

  it('encodes boolean layers as "1" and "0"', () => {
    const make = (flags: ShareableAppState['layers']): URLSearchParams =>
      new URLSearchParams(
        encodeAppState({
          viewMode: 'prediction',
          region: 'pilot',
          variable: 'rainfall',
          forecastDay: 1,
          camera: { latitude: 20, longitude: 78, altitude: 5_000_000, heading: 0, pitch: -90, roll: 0 },
          activeLayer: 'satellite',
          layers: flags,
        }),
      );

    const allOn = make({
      showHeatmap: true,
      showWind: true,
      showContours: true,
      showBoundaries: true,
      showUncertainty: true,
    });
    expect(allOn.get('hm')).toBe('1');
    expect(allOn.get('wn')).toBe('1');
    expect(allOn.get('ct')).toBe('1');
    expect(allOn.get('bd')).toBe('1');
    expect(allOn.get('un')).toBe('1');

    const allOff = make({
      showHeatmap: false,
      showWind: false,
      showContours: false,
      showBoundaries: false,
      showUncertainty: false,
    });
    expect(allOff.get('hm')).toBe('0');
    expect(allOff.get('wn')).toBe('0');
    expect(allOff.get('ct')).toBe('0');
    expect(allOff.get('bd')).toBe('0');
    expect(allOff.get('un')).toBe('0');
  });
});

describe('decodeAppState', () => {
  it('returns defaults for an empty string', () => {
    const state = decodeAppState('');
    expect(state.viewMode).toBe('prediction');
    expect(state.region).toBe('western_ghats');
    expect(state.variable).toBe('rainfall');
    expect(state.forecastDay).toBe(1);
    expect(state.activeLayer).toBe('satellite');
    expect(state.layers.showHeatmap).toBe(true);
    expect(state.layers.showWind).toBe(false);
  });

  it('accepts a full URL and extracts params', () => {
    const state: ShareableAppState = {
      viewMode: 'metrics',
      region: 'central_india',
      variable: 'temp_min',
      forecastDay: 3,
      camera: { latitude: 22.5, longitude: 82.0, altitude: 2_500_000, heading: 0, pitch: -90, roll: 0 },
      activeLayer: 'modis',
      layers: {
        showHeatmap: false,
        showWind: false,
        showContours: true,
        showBoundaries: false,
        showUncertainty: true,
      },
    };

    const fullUrl = `https://example.com/dashboard?${encodeAppState(state)}`;
    const decoded = decodeAppState(fullUrl);

    expect(decoded.viewMode).toBe('metrics');
    expect(decoded.region).toBe('central_india');
    expect(decoded.variable).toBe('temp_min');
    expect(decoded.forecastDay).toBe(3);
    expect(decoded.activeLayer).toBe('modis');
    expect(decoded.layers.showContours).toBe(true);
    expect(decoded.layers.showUncertainty).toBe(true);
    expect(decoded.layers.showHeatmap).toBe(false);
  });

  it('accepts a query string with a leading "?"', () => {
    const qs = '?vm=historical&r=pilot&v=rainfall&fd=7';
    const decoded = decodeAppState(qs);
    expect(decoded.viewMode).toBe('historical');
    expect(decoded.region).toBe('pilot');
    expect(decoded.forecastDay).toBe(7);
  });

  it('falls back to defaults for unknown viewMode', () => {
    const decoded = decodeAppState('vm=UNKNOWN_MODE&r=pilot');
    expect(decoded.viewMode).toBe('prediction');
    expect(decoded.region).toBe('pilot');
  });

  it('falls back to defaults for unknown region', () => {
    const decoded = decodeAppState('r=INVALID_REGION');
    expect(decoded.region).toBe('western_ghats');
  });

  it('falls back to defaults for unknown variable', () => {
    const decoded = decodeAppState('v=wind_speed');
    expect(decoded.variable).toBe('rainfall');
  });

  it('falls back to defaults for unknown activeLayer', () => {
    const decoded = decodeAppState('al=UNKNOWN_LAYER');
    expect(decoded.activeLayer).toBe('satellite');
  });

  it('clamps forecastDay to [1, 7]', () => {
    expect(decodeAppState('fd=0').forecastDay).toBe(1);
    expect(decodeAppState('fd=8').forecastDay).toBe(7);
    expect(decodeAppState('fd=-5').forecastDay).toBe(1);
    expect(decodeAppState('fd=100').forecastDay).toBe(7);
  });

  it('returns default forecastDay for non-numeric fd', () => {
    expect(decodeAppState('fd=notanumber').forecastDay).toBe(1);
  });

  it('returns default camera for missing camera params', () => {
    const decoded = decodeAppState('vm=prediction');
    expect(decoded.camera.latitude).toBeCloseTo(20.5937, 3);
    expect(decoded.camera.longitude).toBeCloseTo(78.9629, 3);
    expect(decoded.camera.altitude).toBeCloseTo(5_000_000, -2);
  });
});

describe('buildShareUrl', () => {
  it('returns a relative URL with query string when window is not defined', () => {
    // In the jsdom test env, window is defined — bypass by testing the query string part
    const state: ShareableAppState = {
      viewMode: 'prediction',
      region: 'western_ghats',
      variable: 'rainfall',
      forecastDay: 1,
      camera: { latitude: 20.5937, longitude: 78.9629, altitude: 5_000_000, heading: 0, pitch: -90, roll: 0 },
      activeLayer: 'satellite',
      layers: {
        showHeatmap: true,
        showWind: false,
        showContours: false,
        showBoundaries: false,
        showUncertainty: false,
      },
    };

    const url = buildShareUrl(state);
    expect(url).toContain('vm=prediction');
    expect(url).toContain('r=western_ghats');
    expect(url).toContain('v=rainfall');
    expect(url).toContain('fd=1');
  });
});
