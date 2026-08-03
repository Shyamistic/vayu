/**
 * Property-Based Test: Forecast Day Selection Renders Correct Lead Time
 *
 * **Validates: Requirements 1.4**
 *
 * Property 1: For any forecast day d in [1, 7] selected by the user, the globe
 * renderer SHALL display grid cells whose values correspond to the prediction
 * data for lead time d, not any other lead time.
 *
 * We test via the Zustand appStore's setForecastDay action which clamps values
 * using Math.max(1, Math.min(7, day)). The stored forecastDay value is then used
 * as the lead_day parameter in the usePrediction hook's query key:
 *   queryKey: ['prediction', date, region, lead_day]
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect, beforeEach } from 'vitest';
import { useAppStore } from './appStore';

describe('Property 1: Forecast Day Selection Renders Correct Lead Time', () => {
  beforeEach(() => {
    // Reset store to default state before each test
    useAppStore.setState({ forecastDay: 1 });
  });

  /**
   * For any integer input (including out-of-range values like negatives and large numbers),
   * setForecastDay always results in a value clamped to [1, 7].
   */
  test.prop([fc.integer({ min: -1000, max: 1000 })])(
    'setForecastDay always clamps to [1, 7] for any integer input',
    (day) => {
      useAppStore.getState().setForecastDay(day);
      const stored = useAppStore.getState().forecastDay;

      expect(stored).toBeGreaterThanOrEqual(1);
      expect(stored).toBeLessThanOrEqual(7);
    }
  );

  /**
   * For any valid forecast day d in [1, 7], the stored value equals d exactly.
   * This ensures the prediction query key will use the correct lead_day.
   */
  test.prop([fc.integer({ min: 1, max: 7 })])(
    'valid day d in [1, 7] is stored exactly (correct lead_day for predictions)',
    (day) => {
      useAppStore.getState().setForecastDay(day);
      const stored = useAppStore.getState().forecastDay;

      expect(stored).toBe(day);
    }
  );

  /**
   * For any day below 1, the stored value is clamped to exactly 1.
   */
  test.prop([fc.integer({ min: -1000, max: 0 })])(
    'days below 1 are clamped to 1',
    (day) => {
      useAppStore.getState().setForecastDay(day);
      const stored = useAppStore.getState().forecastDay;

      expect(stored).toBe(1);
    }
  );

  /**
   * For any day above 7, the stored value is clamped to exactly 7.
   */
  test.prop([fc.integer({ min: 8, max: 1000 })])(
    'days above 7 are clamped to 7',
    (day) => {
      useAppStore.getState().setForecastDay(day);
      const stored = useAppStore.getState().forecastDay;

      expect(stored).toBe(7);
    }
  );

  /**
   * For any numeric input, the stored forecastDay equals Math.max(1, Math.min(7, day)).
   * This verifies the prediction query key ['prediction', date, region, lead_day]
   * will always receive a valid lead_day value that matches the clamping logic.
   */
  test.prop([fc.integer({ min: -1000, max: 1000 })])(
    'stored forecastDay equals Math.max(1, Math.min(7, day)) — correct lead_day for query key',
    (day) => {
      useAppStore.getState().setForecastDay(day);
      const stored = useAppStore.getState().forecastDay;
      const expected = Math.max(1, Math.min(7, day));

      expect(stored).toBe(expected);
    }
  );

  /**
   * For any valid day, changing the forecast day updates only the forecastDay field
   * and no other state — ensuring no unintended side effects on region or variable
   * that would cause incorrect data to be fetched.
   */
  test.prop([fc.integer({ min: 1, max: 7 })])(
    'setForecastDay does not alter region or variable (no cross-contamination in query key)',
    (day) => {
      const stateBefore = useAppStore.getState();
      const regionBefore = stateBefore.selectedRegion;
      const variableBefore = stateBefore.selectedVariable;

      useAppStore.getState().setForecastDay(day);

      const stateAfter = useAppStore.getState();
      expect(stateAfter.selectedRegion).toBe(regionBefore);
      expect(stateAfter.selectedVariable).toBe(variableBefore);
      expect(stateAfter.forecastDay).toBe(day);
    }
  );
});
