import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the mock data detection logic in fetchPrediction
describe('usePrediction — mock data fallback (Req 7.4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchPrediction marks mock data with model_version "mock" when backend fails', async () => {
    // Mock the global fetch to simulate backend error then mock file success
    const mockPrediction = {
      request_date: '2024-01-01',
      lead_times: [1],
      grid_cells: [{ lat: 14.0, lon: 75.0, rainfall: 10, temp_max: 30, temp_min: 20, rainfall_uncertainty: 2, temp_max_uncertainty: 1, temp_min_uncertainty: 1 }],
      model_version: 'vayu-v1',
      input_data_timestamp: '2024-01-01T00:00:00Z',
      cached: false,
    };

    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/predict')) {
        callCount++;
        // Simulate backend error
        return new Response(JSON.stringify({ detail: 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('mock_prediction.json')) {
        return new Response(JSON.stringify(mockPrediction), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    });

    // Import dynamically to avoid module caching issues
    const { fetchPrediction } = await import('../../api/client');
    const result = await fetchPrediction('2024-01-01', 'north_east_india', 1);

    expect(callCount).toBe(1);
    expect(result.model_version).toBe('mock');
    expect(result.grid_cells).toHaveLength(1);
  });

  it('fetchPrediction preserves original model_version when backend succeeds', async () => {
    const realPrediction = {
      request_date: '2024-01-01',
      lead_times: [1],
      grid_cells: [{ lat: 14.0, lon: 75.0, rainfall: 10, temp_max: 30, temp_min: 20, rainfall_uncertainty: 2, temp_max_uncertainty: 1, temp_min_uncertainty: 1 }],
      model_version: 'vayu-v2.1',
      input_data_timestamp: '2024-01-01T00:00:00Z',
      cached: false,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(realPrediction), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { fetchPrediction } = await import('../../api/client');
    const result = await fetchPrediction('2024-01-01', 'western_ghats', 1);

    expect(result.model_version).toBe('vayu-v2.1');
  });
});
