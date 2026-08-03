/**
 * **Validates: Requirements 27.3**
 *
 * For all valid temperature observations and model min/max values, the displayed
 * temperature error is AI prediction minus the sensor observation.
 */
import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import type { GridCell, IoTStation } from '../../types';
import { calculateStationPredictionError } from './sensorNetwork';

const temperatureArb = fc.double({ min: -20, max: 60, noNaN: true, noDefaultInfinity: true });

describe('Sensor prediction error property', () => {
  test.prop([temperatureArb, temperatureArb, temperatureArb])(
    'always reports model midpoint minus observed temperature',
    (tempMin, tempMax, observed) => {
      const station: IoTStation = {
        station_id: 'property-station', name: 'Property station', lat: 12, lon: 75, alt: 0,
        last_seen: null, status: 'online',
        sensors: { temperature_c: observed, humidity_pct: null, pressure_hpa: null, light_lux: null, soil_moisture_pct: null, rain_detected: null, wind_speed_ms: null, wind_gust_ms: null, water_level_cm: null },
        power: null,
      };
      const cell: GridCell = { lat: 12, lon: 75, node_idx: 0, rainfall: 0, temp_max: tempMax, temp_min: tempMin, rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0 };
      expect(calculateStationPredictionError(station, [cell]).temperatureC)
        .toBeCloseTo((tempMax + tempMin) / 2 - observed, 10);
    },
  );
});
