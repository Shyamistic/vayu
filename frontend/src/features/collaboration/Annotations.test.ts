/**
 * Unit tests for Annotations pure functions.
 *
 * Validates: Requirements 45.1, 45.2, 45.3, 45.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateId,
  haversineDistanceKm,
  polygonAreaKm2,
  annotationToFeature,
  annotationsToGeoJSON,
  loadFromStorage,
  saveToStorage,
  formatTimestamp,
  createAnnotation,
  measurementLabel,
  ANNOTATION_COLORS,
  STORAGE_KEY,
} from './Annotations';
import type { Annotation, AnnotationWithSync } from './Annotations';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAnnotation(
  overrides: Partial<Annotation> = {},
): Annotation {
  return {
    id: 'test-id-001',
    type: 'pin',
    coordinates: [77.21, 28.61], // [lon, lat]
    content: 'Test note',
    creator: 'Alice',
    timestamp: '2025-07-15T10:30:00.000Z',
    color: '#f97316',
    ...overrides,
  };
}

function makeAnnotationWithSync(
  overrides: Partial<AnnotationWithSync> = {},
): AnnotationWithSync {
  return { ...makeAnnotation(), syncStatus: 'local', ...overrides };
}

// ── generateId ────────────────────────────────────────────────────────────────

describe('generateId', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateId()).toBe('string');
    expect(generateId().length).toBeGreaterThan(0);
  });

  it('generates unique IDs on repeated calls', () => {
    const ids = new Set(Array.from({ length: 50 }, generateId));
    expect(ids.size).toBe(50);
  });
});

// ── haversineDistanceKm ───────────────────────────────────────────────────────

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistanceKm([77.0, 28.0], [77.0, 28.0])).toBe(0);
  });

  it('is approximately symmetric', () => {
    const a = haversineDistanceKm([77.0, 28.0], [80.0, 25.0]);
    const b = haversineDistanceKm([80.0, 25.0], [77.0, 28.0]);
    expect(a).toBeCloseTo(b, 6);
  });

  it('returns a positive value for distinct points', () => {
    expect(haversineDistanceKm([72.88, 19.08], [77.21, 28.61])).toBeGreaterThan(0);
  });

  it('Delhi to Mumbai is roughly 1150 km', () => {
    // Delhi [77.21, 28.61], Mumbai [72.88, 19.08]
    const d = haversineDistanceKm([77.21, 28.61], [72.88, 19.08]);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1200);
  });

  it('short distance (1°) is approximately 111 km', () => {
    const d = haversineDistanceKm([0, 0], [0, 1]); // 1° latitude
    expect(d).toBeCloseTo(111, 0);
  });
});

// ── polygonAreaKm2 ────────────────────────────────────────────────────────────

describe('polygonAreaKm2', () => {
  it('returns 0 for fewer than 3 points', () => {
    expect(polygonAreaKm2([])).toBe(0);
    expect(polygonAreaKm2([[0, 0]])).toBe(0);
    expect(polygonAreaKm2([[0, 0], [1, 0]])).toBe(0);
  });

  it('returns a positive value for a valid polygon', () => {
    // ~1° × 1° box near equator
    const box = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(polygonAreaKm2(box)).toBeGreaterThan(0);
  });

  it('larger polygon has larger area', () => {
    const small = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const large = [[0, 0], [2, 0], [2, 2], [0, 2]];
    expect(polygonAreaKm2(large)).toBeGreaterThan(polygonAreaKm2(small));
  });
});

// ── createAnnotation ──────────────────────────────────────────────────────────

describe('createAnnotation', () => {
  it('creates a pin annotation with correct defaults', () => {
    const ann = createAnnotation('pin', [77.0, 28.0], 'Bob');
    expect(ann.type).toBe('pin');
    expect(ann.coordinates).toEqual([77.0, 28.0]);
    expect(ann.creator).toBe('Bob');
    expect(ann.color).toBe(ANNOTATION_COLORS.pin);
    expect(ann.popupOpen).toBe(true);
  });

  it('generates a non-empty id', () => {
    const ann = createAnnotation('text', [0, 0], 'Alice');
    expect(typeof ann.id).toBe('string');
    expect(ann.id.length).toBeGreaterThan(0);
  });

  it('two consecutive calls produce different ids', () => {
    const a = createAnnotation('pin', [0, 0], 'X');
    const b = createAnnotation('pin', [0, 0], 'X');
    expect(a.id).not.toBe(b.id);
  });

  it('timestamp is a valid ISO string', () => {
    const ann = createAnnotation('polygon', [[0, 0], [1, 0], [1, 1]], 'C');
    expect(() => new Date(ann.timestamp)).not.toThrow();
    expect(isNaN(new Date(ann.timestamp).getTime())).toBe(false);
  });

  it('uses provided content when supplied', () => {
    const ann = createAnnotation('pin', [0, 0], 'Alice', 'My note');
    expect(ann.content).toBe('My note');
  });

  it('each annotation type receives the correct default color', () => {
    for (const type of ['pin', 'polygon', 'text', 'measurement'] as const) {
      const ann = createAnnotation(type, [0, 0], 'U');
      expect(ann.color).toBe(ANNOTATION_COLORS[type]);
    }
  });
});

// ── measurementLabel ──────────────────────────────────────────────────────────

describe('measurementLabel', () => {
  it('returns empty string for a pin', () => {
    expect(measurementLabel(makeAnnotation({ type: 'pin', coordinates: [0, 0] }))).toBe('');
  });

  it('returns empty string for a text annotation', () => {
    expect(measurementLabel(makeAnnotation({ type: 'text', coordinates: [0, 0] }))).toBe('');
  });

  it('returns a distance string for a measurement with 2 points', () => {
    const ann = makeAnnotation({
      type: 'measurement',
      coordinates: [[77.21, 28.61], [72.88, 19.08]], // Delhi to Mumbai
    });
    const label = measurementLabel(ann);
    expect(label).toMatch(/km/);
  });

  it('returns metres when distance < 1 km', () => {
    const ann = makeAnnotation({
      type: 'measurement',
      coordinates: [[77.0, 28.0], [77.001, 28.0]], // very short
    });
    const label = measurementLabel(ann);
    expect(label).toMatch(/m$/);
  });

  it('returns empty string for measurement with fewer than 2 points', () => {
    const ann = makeAnnotation({ type: 'measurement', coordinates: [[0, 0]] });
    expect(measurementLabel(ann)).toBe('');
  });

  it('returns an area string for a polygon with ≥3 points', () => {
    const ann = makeAnnotation({
      type: 'polygon',
      coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]],
    });
    const label = measurementLabel(ann);
    expect(label).toMatch(/km²|m²/);
  });

  it('returns empty string for a polygon with fewer than 3 points', () => {
    const ann = makeAnnotation({ type: 'polygon', coordinates: [[0, 0], [1, 0]] });
    expect(measurementLabel(ann)).toBe('');
  });
});

// ── annotationToFeature ───────────────────────────────────────────────────────

describe('annotationToFeature', () => {
  it('converts a pin to a GeoJSON Point feature', () => {
    const ann = makeAnnotation({ type: 'pin', coordinates: [77.21, 28.61] });
    const feature = annotationToFeature(ann);
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Point');
    expect(feature.geometry.coordinates).toEqual([77.21, 28.61]);
  });

  it('converts a text annotation to a GeoJSON Point feature', () => {
    const ann = makeAnnotation({ type: 'text', coordinates: [80.0, 20.0] });
    const feature = annotationToFeature(ann);
    expect(feature.geometry.type).toBe('Point');
  });

  it('converts a measurement to a GeoJSON LineString feature', () => {
    const ann = makeAnnotation({
      type: 'measurement',
      coordinates: [[77.21, 28.61], [72.88, 19.08]],
    });
    const feature = annotationToFeature(ann);
    expect(feature.geometry.type).toBe('LineString');
    expect(feature.geometry.coordinates).toEqual([[77.21, 28.61], [72.88, 19.08]]);
  });

  it('converts a polygon to a GeoJSON Polygon feature with closed ring', () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const ann = makeAnnotation({ type: 'polygon', coordinates: ring });
    const feature = annotationToFeature(ann);
    expect(feature.geometry.type).toBe('Polygon');
    const outerRing = (feature.geometry as { type: 'Polygon'; coordinates: number[][][] }).coordinates[0];
    // Last point should equal first point (closed)
    expect(outerRing[0]).toEqual(outerRing[outerRing.length - 1]);
  });

  it('does not double-close an already-closed polygon ring', () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]]; // already closed
    const ann = makeAnnotation({ type: 'polygon', coordinates: ring });
    const feature = annotationToFeature(ann);
    const outerRing = (feature.geometry as { type: 'Polygon'; coordinates: number[][][] }).coordinates[0];
    expect(outerRing).toHaveLength(ring.length); // no extra point appended
  });

  it('preserves annotation metadata in properties', () => {
    const ann = makeAnnotation();
    const feature = annotationToFeature(ann);
    expect(feature.properties.id).toBe(ann.id);
    expect(feature.properties.creator).toBe(ann.creator);
    expect(feature.properties.content).toBe(ann.content);
    expect(feature.properties.timestamp).toBe(ann.timestamp);
    expect(feature.properties.color).toBe(ann.color);
  });

  it('omits popupOpen from feature properties', () => {
    const ann = makeAnnotation({ popupOpen: true });
    const feature = annotationToFeature(ann);
    expect('popupOpen' in feature.properties).toBe(false);
  });
});

// ── annotationsToGeoJSON ──────────────────────────────────────────────────────

describe('annotationsToGeoJSON', () => {
  it('produces a FeatureCollection', () => {
    const geojson = annotationsToGeoJSON([makeAnnotation()]);
    expect(geojson.type).toBe('FeatureCollection');
  });

  it('feature count equals annotation count', () => {
    const anns = [
      makeAnnotation({ id: '1', type: 'pin' }),
      makeAnnotation({ id: '2', type: 'text' }),
      makeAnnotation({ id: '3', type: 'measurement', coordinates: [[0, 0], [1, 1]] }),
    ];
    const geojson = annotationsToGeoJSON(anns);
    expect(geojson.features).toHaveLength(3);
  });

  it('produces a valid FeatureCollection for empty array', () => {
    const geojson = annotationsToGeoJSON([]);
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(0);
  });

  it('each feature has correct geometry type matching annotation type', () => {
    const anns = [
      makeAnnotation({ id: 'p', type: 'pin', coordinates: [0, 0] }),
      makeAnnotation({ id: 'poly', type: 'polygon', coordinates: [[0,0],[1,0],[1,1]] }),
      makeAnnotation({ id: 'm', type: 'measurement', coordinates: [[0,0],[1,1]] }),
    ];
    const geojson = annotationsToGeoJSON(anns);
    expect(geojson.features[0].geometry.type).toBe('Point');
    expect(geojson.features[1].geometry.type).toBe('Polygon');
    expect(geojson.features[2].geometry.type).toBe('LineString');
  });
});

// ── formatTimestamp ───────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('returns a non-empty string for a valid ISO timestamp', () => {
    const result = formatTimestamp('2025-07-15T10:30:00.000Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns the input unchanged for an invalid timestamp', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });

  it('handles edge timestamps without throwing', () => {
    expect(() => formatTimestamp('2000-01-01T00:00:00Z')).not.toThrow();
    expect(() => formatTimestamp('2099-12-31T23:59:59Z')).not.toThrow();
  });
});

// ── localStorage persistence ─────────────────────────────────────────────────

describe('loadFromStorage / saveToStorage', () => {
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;

  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => store[key] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => { store[key] = value; });
  });

  afterEach(() => {
    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.setItem = originalSetItem;
    vi.restoreAllMocks();
  });

  it('returns empty array when storage is empty', () => {
    expect(loadFromStorage()).toEqual([]);
  });

  it('round-trips a list of annotations through storage', () => {
    const annotations: AnnotationWithSync[] = [
      makeAnnotationWithSync({ id: 'a1', type: 'pin' }),
      makeAnnotationWithSync({ id: 'a2', type: 'text', syncStatus: 'synced' }),
    ];
    saveToStorage(annotations);
    const loaded = loadFromStorage();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe('a1');
    expect(loaded[1].id).toBe('a2');
  });

  it('strips syncStatus and popupOpen before storing', () => {
    const annotations: AnnotationWithSync[] = [
      makeAnnotationWithSync({ id: 'x', syncStatus: 'synced', popupOpen: true }),
    ];
    saveToStorage(annotations);
    const raw = JSON.parse(store[STORAGE_KEY]);
    expect(raw[0]).not.toHaveProperty('syncStatus');
    expect(raw[0]).not.toHaveProperty('popupOpen');
  });

  it('loaded annotations have syncStatus set to "local"', () => {
    const annotations: AnnotationWithSync[] = [
      makeAnnotationWithSync({ id: 'y', syncStatus: 'synced' }),
    ];
    saveToStorage(annotations);
    const loaded = loadFromStorage();
    expect(loaded[0].syncStatus).toBe('local');
  });

  it('returns empty array when stored JSON is corrupted', () => {
    store[STORAGE_KEY] = 'not-json{{{';
    expect(loadFromStorage()).toEqual([]);
  });
});
