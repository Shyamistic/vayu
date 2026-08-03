import { describe, expect, it } from 'vitest';
import type { GridCell, IoTStation } from '../../types';
import { calculateStationPredictionError, findNearestGridCell, formatSignedError } from './sensorNetwork';

const station: IoTStation = {
  station_id: 'station-1', name: 'Test Station', lat: 12.1, lon: 75.1, alt: 0,
  last_seen: '2025-01-01T00:00:00Z', status: 'online',
  sensors: { temperature_c: 25, humidity_pct: 80, pressure_hpa: null, light_lux: null, soil_moisture_pct: 60, rain_detected: false, wind_speed_ms: null, wind_gust_ms: null, water_level_cm: null },
  power: { battery_v: 3.9, solar_v: 5.1, charging_ma: 200 },
};

const cells: GridCell[] = [
  { lat: 12, lon: 75, node_idx: 0, rainfall: 6, temp_max: 32, temp_min: 22, rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0 },
  { lat: 16, lon: 80, node_idx: 1, rainfall: 0, temp_max: 40, temp_min: 28, rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0 },
];

describe('sensor prediction error', () => {
  it('uses the closest grid cell for a station', () => {
    expect(findNearestGridCell(station, cells)?.node_idx).toBe(0);
  });

  it('calculates AI prediction minus sensor observation for compatible readings', () => {
    const error = calculateStationPredictionError(station, cells);
    expect(error.temperatureC).toBe(2);
    expect(error.rainfallProxy).toBe(1);
  });

  it('formats signed prediction errors for sensor tooltips', () => {
    expect(formatSignedError(1.25)).toBe('+1.3');
    expect(formatSignedError(-1.25)).toBe('-1.3');
  });
});
