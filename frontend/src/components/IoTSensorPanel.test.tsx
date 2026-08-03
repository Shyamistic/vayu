import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useIoTSensors } from '../core/api/useIoTSensors';
import IoTSensorPanel, { formatLastReport } from './IoTSensorPanel';

vi.mock('../core/api/useIoTSensors', () => ({ useIoTSensors: vi.fn() }));

const mockedUseIoTSensors = vi.mocked(useIoTSensors);

describe('IoTSensorPanel', () => {
  it('shows connectivity, battery level, and last-report health for each station', () => {
    mockedUseIoTSensors.mockReturnValue({
      data: { total: 1, timestamp: '2025-01-01T00:00:00Z', stations: [{
        station_id: 'mausam-1', name: 'Sivasagar', lat: 27, lon: 95, alt: 0,
        last_seen: '2025-01-01T00:00:00Z', status: 'low_battery', sensors: null,
        power: { battery_v: 3.4, solar_v: 4.8, charging_ma: 100 },
      }] },
      isLoading: false, isError: false, isFetching: false, error: null,
    } as never);

    render(<IoTSensorPanel />);
    expect(screen.getByText('Sensor Network Health')).toBeDefined();
    expect(screen.getByText('Low battery')).toBeDefined();
    expect(screen.getByText('3.40 V')).toBeDefined();
    expect(screen.getByText(/Last report:/)).toBeDefined();
  });

  it('formats missing and recent report timestamps safely', () => {
    expect(formatLastReport(null)).toBe('No report received');
    expect(formatLastReport('2025-01-01T00:00:00Z', Date.parse('2025-01-01T00:05:00Z'))).toBe('5m ago');
  });
});
