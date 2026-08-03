import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SivasagarFloodCaseStudy, {
  SIVASAGAR_RAINFALL,
  SIVASAGAR_TIMELINE,
  findSivasagarStation,
  waterLevelState,
} from './SivasagarFloodCaseStudy';

const sivasagarStation = {
  station_id: 'mausam-sgr-001', name: 'Sivasagar Station 1', lat: 26.9847, lon: 94.9376,
  last_seen: '2025-07-15T10:30:00Z', status: 'online' as const, sensors: { water_level_cm: 142.5 },
};

afterEach(() => vi.unstubAllGlobals());

describe('Sivasagar flood case study data', () => {
  it('preloads all four required early-warning milestones', () => {
    expect(SIVASAGAR_TIMELINE.map((step) => step.label)).toEqual([
      '72h before', '48h before', '24h before', 'Event',
    ]);
  });

  it('keeps actual and VAYU rainfall values aligned on a seven-day event sequence', () => {
    expect(SIVASAGAR_RAINFALL).toHaveLength(7);
    expect(SIVASAGAR_RAINFALL.every((point) => point.actual >= 0 && point.predicted >= 0)).toBe(true);
    expect(SIVASAGAR_RAINFALL[SIVASAGAR_RAINFALL.length - 1]).toMatchObject({ label: 'Event', actual: 168, predicted: 154 });
  });

  it('identifies the deployed Sivasagar station and classifies water-level states', () => {
    expect(findSivasagarStation([sivasagarStation])).toBe(sivasagarStation);
    expect(waterLevelState(undefined)).toBe('unavailable');
    expect(waterLevelState(140)).toBe('normal');
    expect(waterLevelState(141)).toBe('watch');
    expect(waterLevelState(161)).toBe('warning');
    expect(waterLevelState(201)).toBe('danger');
  });
});

describe('SivasagarFloodCaseStudy', () => {
  it('renders the case-study evidence and live ESP32 water level', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [sivasagarStation] }));
    render(<SivasagarFloodCaseStudy />);

    expect(screen.getByRole('region', { name: /Sivasagar Flood Early Warning/i })).toBeInTheDocument();
    expect(screen.getByTestId('rainfall-comparison')).toBeInTheDocument();
    expect(screen.getByText(/Actual IMD observations/i)).toBeInTheDocument();
    expect(screen.getByText('┄ VAYU prediction')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/142\.5/)).toBeInTheDocument());
    expect(screen.getByText(/1,78,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /48h before/i }));
    expect(screen.getAllByText(/Flood-risk alert triggered/i)).toHaveLength(2);
    expect(screen.getByText(/Pre-position NDRF\/SDRF boats/i)).toBeInTheDocument();
  });
});
