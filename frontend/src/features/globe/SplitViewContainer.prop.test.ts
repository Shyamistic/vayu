/**
 * Property-Based Test: Split-View Camera and Layout Synchronization
 *
 * **Validates: Requirements 12.2, 12.3**
 *
 * Property 9: For any camera position/orientation in the primary viewport during
 * split-view mode, the secondary viewport SHALL have an identical camera state.
 * Additionally, for any divider position p in [0.2, 0.8], the left viewport width
 * SHALL equal p × total_width (±1px).
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
  syncCamera,
  clampDividerPosition,
  computeLeftWidth,
  MIN_DIVIDER_POSITION,
  MAX_DIVIDER_POSITION,
} from './SplitViewContainer';
import type { SplitViewCameraState } from './SplitViewContainer';

/**
 * Arbitrary: Generate a random camera state with realistic ranges.
 * - latitude: [-90, 90]
 * - longitude: [-180, 180]
 * - altitude: [100, 50_000_000] meters (100m to geostationary orbit)
 * - heading: [0, 360) degrees
 * - pitch: [-90, 0] degrees (Cesium convention: 0=horizon, -90=nadir)
 * - roll: [-180, 180] degrees
 */
const cameraStateArb: fc.Arbitrary<SplitViewCameraState> = fc.record({
  latitude: fc.double({ min: -90, max: 90, noNaN: true }),
  longitude: fc.double({ min: -180, max: 180, noNaN: true }),
  altitude: fc.double({ min: 100, max: 50_000_000, noNaN: true }),
  heading: fc.double({ min: 0, max: 360, noNaN: true }),
  pitch: fc.double({ min: -90, max: 0, noNaN: true }),
  roll: fc.double({ min: -180, max: 180, noNaN: true }),
});

/**
 * Arbitrary: Generate any number (including out-of-range) for divider position testing.
 */
const anyDividerPositionArb = fc.double({
  min: -10,
  max: 10,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Arbitrary: Generate a valid divider position in [0.2, 0.8].
 */
const validDividerPositionArb = fc.double({
  min: MIN_DIVIDER_POSITION,
  max: MAX_DIVIDER_POSITION,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Arbitrary: Generate a realistic total viewport width in pixels [200, 5000].
 */
const totalWidthArb = fc.double({
  min: 200,
  max: 5000,
  noNaN: true,
  noDefaultInfinity: true,
});

describe('Property 9: Split-View Camera and Layout Synchronization', () => {
  /**
   * syncCamera produces an identical state to the source camera.
   * For any camera state, the synced output must equal the input exactly.
   */
  test.prop([cameraStateArb])(
    'syncCamera produces identical camera state',
    (source) => {
      const synced = syncCamera(source);

      expect(synced.latitude).toBe(source.latitude);
      expect(synced.longitude).toBe(source.longitude);
      expect(synced.altitude).toBe(source.altitude);
      expect(synced.heading).toBe(source.heading);
      expect(synced.pitch).toBe(source.pitch);
      expect(synced.roll).toBe(source.roll);
    },
  );

  /**
   * syncCamera returns a new object (not a reference to the same object).
   */
  test.prop([cameraStateArb])(
    'syncCamera returns a distinct object (not the same reference)',
    (source) => {
      const synced = syncCamera(source);
      expect(synced).not.toBe(source);
      expect(synced).toEqual(source);
    },
  );

  /**
   * clampDividerPosition always produces values in [0.2, 0.8] for any input.
   */
  test.prop([anyDividerPositionArb])(
    'clampDividerPosition always produces values in [0.2, 0.8]',
    (position) => {
      const clamped = clampDividerPosition(position);

      expect(clamped).toBeGreaterThanOrEqual(MIN_DIVIDER_POSITION);
      expect(clamped).toBeLessThanOrEqual(MAX_DIVIDER_POSITION);
    },
  );

  /**
   * clampDividerPosition is idempotent — clamping a clamped value returns the same value.
   */
  test.prop([anyDividerPositionArb])(
    'clampDividerPosition is idempotent',
    (position) => {
      const clamped = clampDividerPosition(position);
      const doubleClamped = clampDividerPosition(clamped);

      expect(doubleClamped).toBe(clamped);
    },
  );

  /**
   * For a valid divider position (already in range), clamping preserves the value.
   */
  test.prop([validDividerPositionArb])(
    'clampDividerPosition preserves in-range values',
    (position) => {
      const clamped = clampDividerPosition(position);
      expect(clamped).toBe(position);
    },
  );

  /**
   * computeLeftWidth equals clampDividerPosition(p) × totalWidth (±1px).
   * This validates the layout synchronization property from Requirement 12.3.
   */
  test.prop([anyDividerPositionArb, totalWidthArb])(
    'computeLeftWidth = clampDividerPosition(p) × totalWidth (±1px)',
    (position, totalWidth) => {
      const leftWidth = computeLeftWidth(position, totalWidth);
      const expected = clampDividerPosition(position) * totalWidth;

      expect(Math.abs(leftWidth - expected)).toBeLessThanOrEqual(1);
    },
  );

  /**
   * computeLeftWidth is always non-negative and does not exceed totalWidth.
   */
  test.prop([anyDividerPositionArb, totalWidthArb])(
    'computeLeftWidth is bounded within [0, totalWidth]',
    (position, totalWidth) => {
      const leftWidth = computeLeftWidth(position, totalWidth);

      expect(leftWidth).toBeGreaterThanOrEqual(0);
      expect(leftWidth).toBeLessThanOrEqual(totalWidth);
    },
  );
});
