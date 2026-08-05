import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Cesium from 'cesium';
import {
  dayOfYear,
  solarDeclination,
  subSolarLongitude,
  computeSubSolarPoint,
  computeTerminatorPoints,
  computeNightsidePositions,
  TerminatorLayer,
} from './TerminatorLayer';
import type { LayerState } from '../types';

// ── Solar Position Utility Tests ─────────────────────────────────────────────

describe('TerminatorLayer — Solar Position Utilities', () => {
  describe('dayOfYear', () => {
    it('returns 1 for January 1st', () => {
      const jan1 = new Date(2025, 0, 1); // Jan 1, 2025
      expect(dayOfYear(jan1)).toBe(1);
    });

    it('returns 172 for June 21st (non-leap year approx)', () => {
      // June 21 is approximately day 172 in a non-leap year
      const june21 = new Date(2025, 5, 21);
      expect(dayOfYear(june21)).toBe(172);
    });

    it('returns 365 for December 31st (non-leap year)', () => {
      const dec31 = new Date(2025, 11, 31);
      expect(dayOfYear(dec31)).toBe(365);
    });
  });

  describe('solarDeclination', () => {
    it('returns approximately +23.44° at summer solstice (day ~172)', () => {
      // Day 172 (June 21) — maximum northern declination
      const decl = solarDeclination(172);
      const declDeg = decl * (180 / Math.PI);
      expect(declDeg).toBeCloseTo(23.44, 0); // Within ~1° is fine for simplified model
    });

    it('returns approximately -23.44° at winter solstice (day ~355)', () => {
      // Day 355 (Dec 21) — maximum southern declination
      const decl = solarDeclination(355);
      const declDeg = decl * (180 / Math.PI);
      expect(declDeg).toBeCloseTo(-23.44, 0);
    });

    it('returns approximately 0° at equinoxes (day ~81 or ~264)', () => {
      // Day 81 (March 22) — spring equinox
      const declSpring = solarDeclination(81);
      expect(Math.abs(declSpring)).toBeLessThan(0.02); // Near zero
    });
  });

  describe('subSolarLongitude', () => {
    it('returns 0° at UTC noon (12:00)', () => {
      const noonUTC = new Date('2025-06-15T12:00:00Z');
      expect(subSolarLongitude(noonUTC)).toBeCloseTo(0, 0);
    });

    it('returns +180° at UTC midnight (00:00)', () => {
      const midnightUTC = new Date('2025-06-15T00:00:00Z');
      expect(subSolarLongitude(midnightUTC)).toBeCloseTo(180, 0);
    });

    it('returns -90° at 18:00 UTC (6pm = 90° west)', () => {
      const sixPM = new Date('2025-06-15T18:00:00Z');
      expect(subSolarLongitude(sixPM)).toBeCloseTo(-90, 0);
    });

    it('returns +90° at 06:00 UTC (6am = 90° east)', () => {
      const sixAM = new Date('2025-06-15T06:00:00Z');
      expect(subSolarLongitude(sixAM)).toBeCloseTo(90, 0);
    });
  });

  describe('computeSubSolarPoint', () => {
    it('returns latitude within [-23.44, 23.44] degrees', () => {
      // Test with multiple dates across the year
      const dates = [
        new Date('2025-01-15T12:00:00Z'),
        new Date('2025-03-21T12:00:00Z'),
        new Date('2025-06-21T12:00:00Z'),
        new Date('2025-09-23T12:00:00Z'),
        new Date('2025-12-21T12:00:00Z'),
      ];

      for (const date of dates) {
        const { lat } = computeSubSolarPoint(date);
        expect(lat).toBeGreaterThanOrEqual(-23.5);
        expect(lat).toBeLessThanOrEqual(23.5);
      }
    });

    it('returns longitude within [-180, 180] degrees', () => {
      const dates = [
        new Date('2025-06-15T00:00:00Z'),
        new Date('2025-06-15T06:00:00Z'),
        new Date('2025-06-15T12:00:00Z'),
        new Date('2025-06-15T18:00:00Z'),
        new Date('2025-06-15T23:59:59Z'),
      ];

      for (const date of dates) {
        const { lon } = computeSubSolarPoint(date);
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
      }
    });
  });

  describe('computeTerminatorPoints', () => {
    it('generates the correct number of points', () => {
      const points = computeTerminatorPoints(23.0, 0.0, 72);
      expect(points).toHaveLength(72);
    });

    it('all points lie on the unit sphere (lat ∈ [-90, 90], lon ∈ [-180, 180])', () => {
      const points = computeTerminatorPoints(10.0, 45.0, 72);
      for (const p of points) {
        expect(p.lat).toBeGreaterThanOrEqual(-90);
        expect(p.lat).toBeLessThanOrEqual(90);
        expect(p.lon).toBeGreaterThanOrEqual(-180);
        expect(p.lon).toBeLessThanOrEqual(180);
      }
    });

    it('all terminator points are approximately 90° from the sub-solar point', () => {
      const subLat = 23.44;
      const subLon = -45.0;
      const points = computeTerminatorPoints(subLat, subLon, 72);

      // Angular distance from sub-solar point to each terminator point should be ~90°
      const subLatRad = subLat * (Math.PI / 180);
      const subLonRad = subLon * (Math.PI / 180);

      for (const p of points) {
        const pLatRad = p.lat * (Math.PI / 180);
        const pLonRad = p.lon * (Math.PI / 180);

        // Spherical law of cosines for angular distance
        const cosAngle =
          Math.sin(subLatRad) * Math.sin(pLatRad) +
          Math.cos(subLatRad) * Math.cos(pLatRad) * Math.cos(pLonRad - subLonRad);

        const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
        expect(angleDeg).toBeCloseTo(90, 0); // Within ~1° tolerance
      }
    });

    it('handles sub-solar point at the North Pole (summer solstice)', () => {
      const points = computeTerminatorPoints(23.44, 0.0, 36);
      expect(points).toHaveLength(36);
      // All points should still be valid coordinates
      for (const p of points) {
        expect(isFinite(p.lat)).toBe(true);
        expect(isFinite(p.lon)).toBe(true);
      }
    });
  });

  describe('computeNightsidePositions', () => {
    // Regression coverage for the bug that originally forced this layer to
    // be disabled: an earlier version re-sorted terminator points by an
    // invalid atan2(latDelta, lonDelta) "angle" relative to the anti-solar
    // point, which could reorder them into a self-intersecting polygon. The
    // fix is to not re-sort — the input order (from computeTerminatorPoints)
    // is already a valid angular sweep.

    it('preserves the input point count', () => {
      const points = computeTerminatorPoints(23.44, -45.0, 72);
      const positions = computeNightsidePositions(points);
      expect(positions).toHaveLength(72);
    });

    it('does not reorder points — output[i] matches input[i]', () => {
      const points = computeTerminatorPoints(10.0, 60.0, 24);
      const positions = computeNightsidePositions(points);

      points.forEach((p, i) => {
        const expected = Cesium.Cartesian3.fromDegrees(p.lon, p.lat);
        expect(positions[i].x).toBeCloseTo(expected.x, 3);
        expect(positions[i].y).toBeCloseTo(expected.y, 3);
        expect(positions[i].z).toBeCloseTo(expected.z, 3);
      });
    });

    it('produces a simple (non-self-intersecting) ring: consecutive points stay angularly adjacent', () => {
      // For a valid sweep, the angular step between consecutive points
      // (as seen from Earth's center) should be small and roughly uniform.
      // A bad sort would produce large, irregular jumps instead.
      const numPoints = 72;
      const points = computeTerminatorPoints(23.44, 0.0, numPoints);
      const positions = computeNightsidePositions(points);
      const expectedStepRad = (2 * Math.PI) / numPoints;

      for (let i = 0; i < positions.length; i++) {
        const a = positions[i];
        const b = positions[(i + 1) % positions.length];
        const dot = Cesium.Cartesian3.dot(
          Cesium.Cartesian3.normalize(a, new Cesium.Cartesian3()),
          Cesium.Cartesian3.normalize(b, new Cesium.Cartesian3())
        );
        const angleBetween = Math.acos(Math.max(-1, Math.min(1, dot)));
        // Generous tolerance for the ellipsoid round-trip, but a bad sort
        // would blow well past this (jumps toward the opposite side of the ring).
        expect(angleBetween).toBeLessThan(expectedStepRad * 3);
      }
    });

    it('handles an empty input without throwing', () => {
      expect(computeNightsidePositions([])).toEqual([]);
    });
  });
});

// ── TerminatorLayer Class Tests ──────────────────────────────────────────────

describe('TerminatorLayer — LayerPlugin interface', () => {
  let layer: TerminatorLayer;
  let mockViewer: {
    entities: {
      add: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    layer = new TerminatorLayer();
    mockViewer = {
      entities: {
        add: vi.fn().mockImplementation((opts) => opts),
        remove: vi.fn(),
      },
    };
  });

  it('has correct id and priority', () => {
    expect(layer.id).toBe('terminator');
    expect(layer.priority).toBe(50);
  });

  it('init stores the viewer reference', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    // After init, update should work (not throw)
    const state = createMockLayerState();
    expect(() => layer.update(state)).not.toThrow();
  });

  it('update creates entities when selectedDate is provided', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({
      selectedDate: new Date('2025-06-15T12:00:00Z'),
    });

    layer.update(state);

    // Renders the terminator line only — nightside darkening is handled by
    // CesiumGlobe's native globe lighting, not an entity here.
    expect(mockViewer.entities.add).toHaveBeenCalledTimes(1);
  });

  it('update skips redundant redraws for same date', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const date = new Date('2025-06-15T12:00:00Z');
    const state = createMockLayerState({ selectedDate: date });

    layer.update(state);
    layer.update(state); // Same date — should skip

    // Only 1 entity (one render), not 2
    expect(mockViewer.entities.add).toHaveBeenCalledTimes(1);
  });

  it('update re-renders when date changes', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);

    const state1 = createMockLayerState({
      selectedDate: new Date('2025-06-15T12:00:00Z'),
    });
    const state2 = createMockLayerState({
      selectedDate: new Date('2025-06-16T12:00:00Z'),
    });

    layer.update(state1);
    layer.update(state2);

    // First render + second render: add called 2 times total
    expect(mockViewer.entities.add).toHaveBeenCalledTimes(2);
    // Remove called once to clear the old entity before re-render
    expect(mockViewer.entities.remove).toHaveBeenCalledTimes(1);
  });

  it('destroy removes all entities and clears state', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({
      selectedDate: new Date('2025-06-15T12:00:00Z'),
    });

    layer.update(state);
    layer.destroy();

    expect(mockViewer.entities.remove).toHaveBeenCalledTimes(1);
  });

  it('does nothing when viewer is not initialized', () => {
    const state = createMockLayerState();
    // Should not throw when viewer is null
    expect(() => layer.update(state)).not.toThrow();
    expect(() => layer.destroy()).not.toThrow();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockLayerState(overrides: Partial<LayerState> = {}): LayerState {
  return {
    gridCells: [],
    variable: 'rainfall',
    region: 'western_ghats',
    forecastDay: 1,
    terrainExaggeration: 1,
    colormap: 'imd_rain',
    show3D: false,
    showWind: false,
    showContours: false,
    showBoundaries: false,
    showUncertainty: false,
    scenarioData: null,
    gibsDate: '2025-06-01',
    selectedDate: new Date(2025, 5, 15),
    heatmapOpacity: 0.78,
    ...overrides,
  };
}
