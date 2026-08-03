/**
 * Property-Based Test: Heatmap Opacity Range Enforcement
 *
 * **Validates: Requirements 4.3**
 *
 * Property 4: For any opacity value set via slider with Photorealistic Tiles active,
 * verify alpha is clamped to [0.3, 0.9].
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
  clampHeatmapOpacity,
  HEATMAP_OPACITY_MIN,
  HEATMAP_OPACITY_MAX,
} from './Google3DTilesLayer';

describe('Property 4: Heatmap Opacity Range Enforcement', () => {
  /**
   * For any arbitrary floating point number (including negatives, zero,
   * and very large values), the clamped result is always within [0.3, 0.9].
   */
  test.prop([fc.double({ noNaN: true, noDefaultInfinity: false })])(
    'clampHeatmapOpacity always returns a value in [0.3, 0.9]',
    (value) => {
      const result = clampHeatmapOpacity(value);

      expect(result).toBeGreaterThanOrEqual(HEATMAP_OPACITY_MIN);
      expect(result).toBeLessThanOrEqual(HEATMAP_OPACITY_MAX);
    },
  );

  /**
   * For any value already within [0.3, 0.9], the function returns it unchanged.
   */
  test.prop([fc.double({ min: 0.3, max: 0.9, noNaN: true })])(
    'values already in [0.3, 0.9] are returned unchanged',
    (value) => {
      const result = clampHeatmapOpacity(value);

      expect(result).toBe(value);
    },
  );

  /**
   * Boundary values: 0.3 maps to 0.3 and 0.9 maps to 0.9.
   */
  test.prop([fc.constant(0.3), fc.constant(0.9)])(
    'boundary values 0.3 and 0.9 are preserved exactly',
    (min, max) => {
      expect(clampHeatmapOpacity(min)).toBe(0.3);
      expect(clampHeatmapOpacity(max)).toBe(0.9);
    },
  );

  /**
   * Any value below 0.3 is clamped up to 0.3.
   */
  test.prop([fc.double({ max: 0.3 - Number.EPSILON, noNaN: true, noDefaultInfinity: false })])(
    'values below 0.3 are clamped to 0.3',
    (value) => {
      const result = clampHeatmapOpacity(value);

      expect(result).toBe(HEATMAP_OPACITY_MIN);
    },
  );

  /**
   * Any value above 0.9 is clamped down to 0.9.
   */
  test.prop([fc.double({ min: 0.9 + Number.EPSILON, noNaN: true, noDefaultInfinity: false })])(
    'values above 0.9 are clamped to 0.9',
    (value) => {
      const result = clampHeatmapOpacity(value);

      expect(result).toBe(HEATMAP_OPACITY_MAX);
    },
  );
});
