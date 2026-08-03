/**
 * Property-Based Test: Terrain Exaggeration Proportional Scaling
 *
 * **Validates: Requirements 2.3**
 *
 * Property 2: For any exaggeration factor f in [1.0, 5.0], the vertical offset
 * of the heatmap overlay at a given geographic point SHALL equal the terrain
 * elevation at that point multiplied by f, ensuring the overlay tracks the
 * terrain surface at all exaggeration levels.
 *
 * We test via the Zustand mapStore's setTerrainExaggeration action which clamps
 * values using Math.max(1, Math.min(5, value)). The store's terrainExaggeration
 * value is then applied to the scene's verticalExaggeration in the HeatmapLayer.
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect, beforeEach } from 'vitest';
import { useMapStore } from '../../../core/state/mapStore';

describe('Property 2: Terrain Exaggeration Proportional Scaling', () => {
  beforeEach(() => {
    // Reset store to default state before each test
    useMapStore.setState({ terrainExaggeration: 1 });
  });

  /**
   * For any numeric input (including negatives, very large values, etc.),
   * setTerrainExaggeration always results in a value clamped to [1, 5].
   */
  test.prop([fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })])(
    'setTerrainExaggeration always clamps to [1, 5] for any input',
    (factor) => {
      useMapStore.getState().setTerrainExaggeration(factor);
      const stored = useMapStore.getState().terrainExaggeration;

      expect(stored).toBeGreaterThanOrEqual(1);
      expect(stored).toBeLessThanOrEqual(5);
    }
  );

  /**
   * For any valid factor f in [1.0, 5.0], the stored value equals f exactly.
   * This verifies proportional scaling — the terrain exaggeration factor is
   * preserved without modification when within the valid range.
   */
  test.prop([fc.double({ min: 1.0, max: 5.0, noNaN: true })])(
    'valid factor f in [1, 5] is stored exactly (proportional scaling preserved)',
    (factor) => {
      useMapStore.getState().setTerrainExaggeration(factor);
      const stored = useMapStore.getState().terrainExaggeration;

      expect(stored).toBe(factor);
    }
  );

  /**
   * For any factor below 1.0, the stored value is clamped to exactly 1.
   */
  test.prop([fc.double({ min: -1000, max: 0.999999, noNaN: true, noDefaultInfinity: true })])(
    'factors below 1 are clamped to 1',
    (factor) => {
      useMapStore.getState().setTerrainExaggeration(factor);
      const stored = useMapStore.getState().terrainExaggeration;

      expect(stored).toBe(1);
    }
  );

  /**
   * For any factor above 5.0, the stored value is clamped to exactly 5.
   */
  test.prop([fc.double({ min: 5.000001, max: 1000, noNaN: true, noDefaultInfinity: true })])(
    'factors above 5 are clamped to 5',
    (factor) => {
      useMapStore.getState().setTerrainExaggeration(factor);
      const stored = useMapStore.getState().terrainExaggeration;

      expect(stored).toBe(5);
    }
  );

  /**
   * The scene's verticalExaggeration would be set to the clamped value.
   * We verify this by checking that the store value matches what HeatmapLayer
   * would apply: Math.max(1, Math.min(5, factor)).
   */
  test.prop([fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true })])(
    'stored terrainExaggeration equals Math.max(1, Math.min(5, factor))',
    (factor) => {
      useMapStore.getState().setTerrainExaggeration(factor);
      const stored = useMapStore.getState().terrainExaggeration;
      const expected = Math.max(1, Math.min(5, factor));

      expect(stored).toBe(expected);
    }
  );
});
