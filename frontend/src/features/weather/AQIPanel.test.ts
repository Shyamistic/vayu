/**
 * Unit tests for AQIPanel pure functions.
 *
 * Tests cover:
 *  - AQI classification into categories (Req 23.2)
 *  - Color mapping per category (Req 23.2)
 *  - Sub-index computations for all five pollutants (Req 23.1)
 *  - Composite AQI = max of sub-indices, correct dominant pollutant
 *  - Alert generation when AQI > 200 (Req 23.3)
 *  - Wind-AQI correlation with nearest-cell matching (Req 23.4)
 */

import { describe, expect, it } from 'vitest';
import {
  AQI_ALERT_THRESHOLD,
  AQI_BREAKPOINTS,
  aqiToColor,
  buildAQIGridCells,
  classifyAQI,
  computeAQI,
  computeWindAQICorrelation,
  generateAQIAlerts,
  getAQIBreakpoint,
  no2SubIndex,
  o3SubIndex,
  pm10SubIndex,
  pm25SubIndex,
  so2SubIndex,
  type AQIPollutants,
} from './AQIPanel';

// ── classifyAQI ───────────────────────────────────────────────────────────────

describe('classifyAQI', () => {
  it('classifies 0 as Good', () => {
    expect(classifyAQI(0)).toBe('Good');
  });

  it('classifies 50 as Good (inclusive upper bound)', () => {
    expect(classifyAQI(50)).toBe('Good');
  });

  it('classifies 51 as Moderate', () => {
    expect(classifyAQI(51)).toBe('Moderate');
  });

  it('classifies 100 as Moderate', () => {
    expect(classifyAQI(100)).toBe('Moderate');
  });

  it('classifies 101 as Unhealthy for Sensitive Groups', () => {
    expect(classifyAQI(101)).toBe('Unhealthy for Sensitive Groups');
  });

  it('classifies 151 as Unhealthy', () => {
    expect(classifyAQI(151)).toBe('Unhealthy');
  });

  it('classifies 200 as Unhealthy (inclusive)', () => {
    expect(classifyAQI(200)).toBe('Unhealthy');
  });

  it('classifies 201 as Very Unhealthy', () => {
    expect(classifyAQI(201)).toBe('Very Unhealthy');
  });

  it('classifies 301 as Hazardous', () => {
    expect(classifyAQI(301)).toBe('Hazardous');
  });

  it('classifies > 500 as Hazardous (cap)', () => {
    expect(classifyAQI(600)).toBe('Hazardous');
  });

  it('handles negative values by clamping to 0 → Good', () => {
    expect(classifyAQI(-10)).toBe('Good');
  });
});

// ── aqiToColor ────────────────────────────────────────────────────────────────

describe('aqiToColor', () => {
  it('returns green for Good AQI', () => {
    expect(aqiToColor(25)).toBe('#22c55e');
  });

  it('returns yellow for Moderate AQI', () => {
    expect(aqiToColor(75)).toBe('#eab308');
  });

  it('returns purple for Very Unhealthy AQI', () => {
    expect(aqiToColor(250)).toBe('#a855f7');
  });

  it('returns dark red for Hazardous AQI', () => {
    expect(aqiToColor(400)).toBe('#7f1d1d');
  });

  it('every breakpoint category maps to a non-empty color string', () => {
    AQI_BREAKPOINTS.forEach((bp) => {
      const color = aqiToColor(bp.min);
      expect(color).toBeTruthy();
      expect(color.startsWith('#')).toBe(true);
    });
  });
});

// ── getAQIBreakpoint ──────────────────────────────────────────────────────────

describe('getAQIBreakpoint', () => {
  it('returns the correct breakpoint object for a given AQI', () => {
    const bp = getAQIBreakpoint(120);
    expect(bp.category).toBe('Unhealthy for Sensitive Groups');
    expect(bp.min).toBe(101);
    expect(bp.max).toBe(150);
  });
});

// ── Pollutant sub-index computations ─────────────────────────────────────────

describe('pm25SubIndex', () => {
  it('returns 0 for concentration 0', () => {
    expect(pm25SubIndex(0)).toBe(0);
  });

  it('returns 50 for PM2.5 = 12 μg/m³', () => {
    expect(pm25SubIndex(12)).toBe(50);
  });

  it('returns 100 for PM2.5 = 35.4 μg/m³', () => {
    expect(pm25SubIndex(35.4)).toBe(100);
  });

  it('returns ≥ 200 for PM2.5 = 150 μg/m³', () => {
    expect(pm25SubIndex(150)).toBeGreaterThanOrEqual(200);
  });

  it('caps at 500 for very high concentrations', () => {
    expect(pm25SubIndex(600)).toBe(500);
  });
});

describe('pm10SubIndex', () => {
  it('returns 50 for PM10 = 54 μg/m³', () => {
    expect(pm10SubIndex(54)).toBe(50);
  });

  it('returns 100 for PM10 = 154 μg/m³', () => {
    expect(pm10SubIndex(154)).toBe(100);
  });
});

describe('o3SubIndex', () => {
  it('returns 0 for O3 = 0', () => {
    expect(o3SubIndex(0)).toBe(0);
  });

  it('returns value > 100 for high O3 concentration', () => {
    expect(o3SubIndex(200)).toBeGreaterThan(100);
  });
});

describe('no2SubIndex', () => {
  it('returns low index for clean air NO2 level', () => {
    expect(no2SubIndex(50)).toBeLessThanOrEqual(50);
  });
});

describe('so2SubIndex', () => {
  it('returns 0 for SO2 = 0', () => {
    expect(so2SubIndex(0)).toBe(0);
  });

  it('returns > 100 for SO2 > 197 μg/m³', () => {
    expect(so2SubIndex(250)).toBeGreaterThan(100);
  });
});

// ── computeAQI ────────────────────────────────────────────────────────────────

describe('computeAQI', () => {
  it('returns max of all sub-indices as composite AQI', () => {
    const pollutants: AQIPollutants = {
      pm2_5: 12,  // sub-index ~50
      pm10:  54,  // sub-index ~50
      o3:    0,   // sub-index 0
      no2:   0,   // sub-index 0
      so2:   0,   // sub-index 0
    };
    const { aqi } = computeAQI(pollutants);
    expect(aqi).toBeGreaterThanOrEqual(50);
    expect(aqi).toBeLessThanOrEqual(55);
  });

  it('identifies dominant pollutant correctly', () => {
    const pollutants: AQIPollutants = {
      pm2_5: 200, // will be highest sub-index
      pm10:  50,
      o3:    30,
      no2:   20,
      so2:   10,
    };
    const { dominantPollutant } = computeAQI(pollutants);
    expect(dominantPollutant).toBe('pm2_5');
  });

  it('returns AQI = 0 for all-zero pollutants', () => {
    const clean: AQIPollutants = { pm2_5: 0, pm10: 0, o3: 0, no2: 0, so2: 0 };
    const { aqi } = computeAQI(clean);
    expect(aqi).toBe(0);
  });
});

// ── buildAQIGridCells ─────────────────────────────────────────────────────────

describe('buildAQIGridCells', () => {
  it('creates one AQIGridCell per raw data point', () => {
    const raw = [
      { lat: 28.5, lon: 77.2, pollutants: { pm2_5: 100, pm10: 150, o3: 60, no2: 80, so2: 20 } },
      { lat: 19.0, lon: 72.9, pollutants: { pm2_5: 10,  pm10: 20,  o3: 30, no2: 15, so2: 5  } },
    ];
    const cells = buildAQIGridCells(raw);
    expect(cells).toHaveLength(2);
  });

  it('assigns correct AQI category to each cell', () => {
    const raw = [
      { lat: 0, lon: 0, pollutants: { pm2_5: 10, pm10: 20, o3: 30, no2: 15, so2: 5 } },
    ];
    const [cell] = buildAQIGridCells(raw);
    expect(cell.category).toBe('Good');
  });

  it('assigns the dominant pollutant to each cell', () => {
    const raw = [
      { lat: 0, lon: 0, pollutants: { pm2_5: 200, pm10: 50, o3: 30, no2: 20, so2: 10 } },
    ];
    const [cell] = buildAQIGridCells(raw);
    expect(cell.dominantPollutant).toBe('pm2_5');
  });
});

// ── generateAQIAlerts ─────────────────────────────────────────────────────────

describe('generateAQIAlerts', () => {
  it(`generates alerts only for cells with AQI > ${AQI_ALERT_THRESHOLD}`, () => {
    const raw = [
      { lat: 28.5, lon: 77.2, pollutants: { pm2_5: 200, pm10: 300, o3: 150, no2: 200, so2: 100 } }, // high
      { lat: 19.0, lon: 72.9, pollutants: { pm2_5: 10,  pm10: 20,  o3: 30,  no2: 15,  so2: 5   } }, // low
    ];
    const cells = buildAQIGridCells(raw);
    const alerts = generateAQIAlerts(cells);
    expect(alerts.every((a) => a.aqi > AQI_ALERT_THRESHOLD)).toBe(true);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('returns empty array when no cells exceed threshold', () => {
    const raw = [
      { lat: 0, lon: 0, pollutants: { pm2_5: 5, pm10: 10, o3: 20, no2: 10, so2: 3 } },
    ];
    const cells = buildAQIGridCells(raw);
    expect(generateAQIAlerts(cells)).toHaveLength(0);
  });

  it('sorts alerts by descending AQI', () => {
    const raw = [
      { lat: 1, lon: 1, pollutants: { pm2_5: 200, pm10: 300, o3: 150, no2: 200, so2: 80  } },
      { lat: 2, lon: 2, pollutants: { pm2_5: 300, pm10: 400, o3: 200, no2: 300, so2: 150 } },
      { lat: 3, lon: 3, pollutants: { pm2_5: 150, pm10: 250, o3: 100, no2: 150, so2: 60  } },
    ];
    const cells = buildAQIGridCells(raw);
    const alerts = generateAQIAlerts(cells);
    for (let i = 0; i < alerts.length - 1; i++) {
      expect(alerts[i].aqi).toBeGreaterThanOrEqual(alerts[i + 1].aqi);
    }
  });

  it('includes the location and category in the alert message', () => {
    const raw = [
      { lat: 28.61, lon: 77.21, pollutants: { pm2_5: 250, pm10: 350, o3: 200, no2: 250, so2: 100 } },
    ];
    const cells = buildAQIGridCells(raw);
    const [alert] = generateAQIAlerts(cells);
    expect(alert.message).toMatch(/28\.\d+/);
    expect(alert.message).toMatch(/77\.\d+/);
    expect(alert.category).not.toBe('');
  });
});

// ── computeWindAQICorrelation ─────────────────────────────────────────────────

describe('computeWindAQICorrelation', () => {
  it('returns empty array when no wind cells provided', () => {
    const raw = [
      { lat: 0, lon: 0, pollutants: { pm2_5: 50, pm10: 80, o3: 40, no2: 30, so2: 10 } },
    ];
    const cells = buildAQIGridCells(raw);
    expect(computeWindAQICorrelation(cells, [])).toHaveLength(0);
  });

  it('returns one correlation point per AQI cell', () => {
    const raw = [
      { lat: 28.5, lon: 77.2, pollutants: { pm2_5: 50, pm10: 80, o3: 40, no2: 30, so2: 10 } },
      { lat: 19.0, lon: 72.9, pollutants: { pm2_5: 30, pm10: 60, o3: 30, no2: 20, so2: 8  } },
    ];
    const cells = buildAQIGridCells(raw);
    const wind = [
      { lat: 28.5, lon: 77.2, wind_speed: 3.5, wind_direction: 180 },
      { lat: 19.0, lon: 72.9, wind_speed: 6.0, wind_direction: 270 },
    ];
    const corr = computeWindAQICorrelation(cells, wind);
    expect(corr).toHaveLength(2);
  });

  it('snaps each AQI cell to the nearest wind cell', () => {
    const raw = [
      { lat: 28.5, lon: 77.2, pollutants: { pm2_5: 50, pm10: 80, o3: 40, no2: 30, so2: 10 } },
    ];
    const cells = buildAQIGridCells(raw);
    const wind = [
      { lat: 28.6, lon: 77.3, wind_speed: 4.0, wind_direction: 90 },
      { lat: 10.0, lon: 60.0, wind_speed: 2.0, wind_direction: 45 },
    ];
    const [corr] = computeWindAQICorrelation(cells, wind);
    // Nearest wind cell is the one at 28.6, 77.3
    expect(corr.windSpeed).toBeCloseTo(4.0, 3);
  });
});
